import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  constants as fsConstants,
} from "node:fs";

import type {
  Stats,
} from "node:fs";

import fs from "node:fs/promises";

import {
  dirname,
  join,
} from "node:path";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  assertVerifiedPackagePublicationBundle,
} from "../publish/packagePublicationBundle.js";

import type {
  PackagePublicationReceipt,
  VerifiedPackagePublicationBundle,
} from "../publish/packagePublicationBundle.js";

import {
  AURORA_OFFICIAL_PACKAGE_SIGNING_KEY_ID,
  AURORA_OFFICIAL_PUBLISHER_ID,
} from "../trust/officialPublisherTrust.js";

import {
  canonicalizeJson,
} from "../trust/packageCanonicalJson.js";

import {
  isPackageKeyId,
  PACKAGE_SIGNATURE_VERSION,
  PACKAGE_SIGNING_ALGORITHM,
} from "../trust/packageTrustTypes.js";

import {
  compareOfficialRegistryPackageEntries,
  OFFICIAL_REGISTRY_KIND,
  OFFICIAL_REGISTRY_MAX_ENTRIES,
  OFFICIAL_REGISTRY_SCHEMA_VERSION,
  parseOfficialRegistrySnapshot,
} from "./officialRegistrySchema.js";

import type {
  OfficialRegistryPackageEntry,
  OfficialRegistrySignature,
  OfficialRegistrySnapshot,
} from "./officialRegistrySchema.js";

import {
  createOfficialRegistrySigningPayload,
  OFFICIAL_REGISTRY_SIGNING_DOMAIN,
} from "./officialRegistrySigningPayload.js";

import {
  assertVerifiedOfficialRegistrySnapshot,
} from "./officialRegistryVerifier.js";

import type {
  VerifiedOfficialRegistrySnapshot,
} from "./officialRegistryVerifier.js";

import {
  durableCreateDirectory,
  durableEnsureDirectory,
  durableWriteFile,
  syncDirectory,
} from "../lifecycle/durableFileWriter.js";

const PROPOSAL_FILE_NAME =
  "proposal.json";

const SIGNING_PAYLOAD_FILE_NAME =
  "registry-signing-payload.bin";

const PLACEHOLDER_SIGNATURE_VALUE =
  Buffer.alloc(64).toString(
    "base64url"
  );

const authenticReleaseProposals =
  new WeakSet<object>();

export const OFFICIAL_REGISTRY_RELEASE_PROPOSAL_VERSION =
  1 as const;

export const OFFICIAL_REGISTRY_RELEASE_PROPOSAL_KIND =
  "aurora-official-registry-release-proposal" as const;

export interface UnsignedOfficialRegistrySnapshot {
  readonly registryVersion:
    typeof OFFICIAL_REGISTRY_SCHEMA_VERSION;

  readonly kind:
    typeof OFFICIAL_REGISTRY_KIND;

  readonly sequence: number;

  readonly publishedAt: string;

  readonly previousSnapshotDigest:
    string;

  readonly publisherId:
    typeof AURORA_OFFICIAL_PUBLISHER_ID;

  readonly packages:
    readonly OfficialRegistryPackageEntry[];

  readonly signature:
    Omit<
      OfficialRegistrySignature,
      "value"
    >;
}

export interface OfficialRegistryReleaseProposalDocument {
  readonly proposalVersion:
    typeof OFFICIAL_REGISTRY_RELEASE_PROPOSAL_VERSION;

  readonly kind:
    typeof OFFICIAL_REGISTRY_RELEASE_PROPOSAL_KIND;

  readonly publication: {
    readonly packageId: string;
    readonly version: string;
    readonly publisherId: string;
    readonly packageSigningKeyId:
      string;
    readonly manifestDigest:
      string;
    readonly receiptDigest:
      string;
    readonly archive: {
      readonly algorithm:
        "sha256";
      readonly digest: string;
      readonly size: number;
      readonly url: string;
    };
  };

  readonly predecessor: {
    readonly sequence: number;
    readonly digest: string;
  };

  readonly unsignedSnapshot:
    UnsignedOfficialRegistrySnapshot;

  readonly signing: {
    readonly domain:
      typeof OFFICIAL_REGISTRY_SIGNING_DOMAIN;
    readonly algorithm:
      typeof PACKAGE_SIGNING_ALGORITHM;
    readonly keyId: string;
    readonly payload: {
      readonly algorithm:
        "sha256";
      readonly encoding:
        "base64";
      readonly digest: string;
      readonly value: string;
    };
  };
}

export interface VerifiedOfficialRegistryReleaseProposal {
  readonly source:
    "verified-official-registry-release-proposal";

  readonly document:
    OfficialRegistryReleaseProposalDocument;

  readonly proposalBytes:
    () => Buffer;

  readonly signingPayloadBytes:
    () => Buffer;
}

export interface OfficialRegistryReleaseProposalOptions {
  readonly archiveUrl: string;
  readonly publishedAt: string;
  readonly signingKeyId?: string;
}

export interface OfficialRegistryReleaseProposalWriterOptions {
  readonly workspaceRoot: string;
  readonly proposalDirectory?: string;
}

export interface WrittenOfficialRegistryReleaseProposal {
  readonly document:
    OfficialRegistryReleaseProposalDocument;

  readonly proposalPath: string;
  readonly proposalFile: string;
  readonly signingPayloadFile: string;
}

function releaseFailure(
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official registry release proposal failed: ${message}`,
    {
      code:
        ErrorCodes
          .REGISTRY_RELEASE_PROPOSAL_FAILED,
      suggestion:
        "Use a verified predecessor, an authentic publication bundle, a forward-only package version, and a content-addressed HTTPS artifact URL.",
      cause,
    }
  );
}

function sha256(
  value: Uint8Array
): string {
  return createHash(
    "sha256"
  )
    .update(value)
    .digest("hex");
}

function deepFreeze<T>(
  value: T
): T {
  if (
    typeof value !==
      "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child
    of Object.values(value)
  ) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function assertCanonicalPublishedAt(
  publishedAt: string,
  predecessorPublishedAt:
    string
): void {
  const candidate =
    new Date(publishedAt);

  if (
    Number.isNaN(
      candidate.getTime()
    ) ||
    candidate.toISOString() !==
      publishedAt
  ) {
    throw releaseFailure(
      "publishedAt must be a canonical UTC ISO-8601 timestamp."
    );
  }

  if (
    candidate.getTime() <
      Date.parse(
        predecessorPublishedAt
      )
  ) {
    throw releaseFailure(
      "publishedAt cannot move backwards from the verified predecessor."
    );
  }
}

function assertImmutableArchiveUrl(
  value: string,
  archiveDigest: string
): void {
  let parsed: URL;

  try {
    parsed = new URL(value);
  }
  catch (error) {
    throw releaseFailure(
      "archiveUrl is not a valid URL.",
      error
    );
  }

  const pathSegments =
    parsed.pathname
      .split("/")
      .filter(
        segment =>
          segment.length > 0
      );

  if (
    parsed.protocol !==
      "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.search.length > 0 ||
    parsed.toString() !==
      value ||
    pathSegments.length < 2 ||
    pathSegments[
      pathSegments.length - 2
    ] !== archiveDigest ||
    pathSegments[
      pathSegments.length - 1
    ] !== "package.tar.gz"
  ) {
    throw releaseFailure(
      "archiveUrl must be canonical HTTPS without credentials, query, or fragment and must end in '/<archive-digest>/package.tar.gz'."
    );
  }
}

function assertPublicationIntegrity(
  publication:
    VerifiedPackagePublicationBundle
): {
  readonly receipt:
    PackagePublicationReceipt;
  readonly receiptBytes:
    Buffer;
} {
  const receipt =
    publication.receipt;

  if (
    receipt.signature ===
      null
  ) {
    throw releaseFailure(
      "the publication manifest must carry an authenticated package signature."
    );
  }

  const archive =
    publication.archiveBytes();

  if (
    archive.byteLength !==
      receipt.archive.size ||
    sha256(archive) !==
      receipt.archive.digest
  ) {
    throw releaseFailure(
      "the authentic publication archive no longer matches its receipt."
    );
  }

  const receiptBytes =
    publication.receiptBytes();

  const canonicalReceipt =
    Buffer.from(
      `${canonicalizeJson(
        receipt
      )}\n`,
      "utf8"
    );

  if (
    !receiptBytes.equals(
      canonicalReceipt
    )
  ) {
    throw releaseFailure(
      "the authentic publication receipt is not its canonical byte representation."
    );
  }

  return {
    receipt,
    receiptBytes,
  };
}

function cloneRegistryEntry(
  entry:
    OfficialRegistryPackageEntry
): OfficialRegistryPackageEntry {
  return {
    packageId:
      entry.packageId,
    version:
      entry.version,
    manifestDigest:
      entry.manifestDigest,
    archive: {
      algorithm:
        entry.archive.algorithm,
      digest:
        entry.archive.digest,
      size:
        entry.archive.size,
      url:
        entry.archive.url,
    },
    provenance: {
      type:
        entry.provenance.type,
      url:
        entry.provenance.url,
      reference:
        entry.provenance.reference,
    },
    lifecycle:
      entry.lifecycle.status ===
        "active"
        ? {
            status:
              "active",
          }
        : {
            status:
              "revoked",
            reason:
              entry.lifecycle.reason,
          },
  };
}

function createRegistryEntry(
  receipt:
    PackagePublicationReceipt,
  archiveUrl: string
): OfficialRegistryPackageEntry {
  return {
    packageId:
      receipt.packageId,
    version:
      receipt.version,
    manifestDigest:
      receipt.manifestDigest,
    archive: {
      algorithm:
        "sha256",
      digest:
        receipt.archive.digest,
      size:
        receipt.archive.size,
      url:
        archiveUrl,
    },
    provenance: {
      type:
        receipt.provenance.type,
      url:
        receipt.provenance.url,
      reference:
        receipt.provenance.reference,
    },
    lifecycle: {
      status:
        "active",
    },
  };
}

function assertVersionAdvances(
  packages:
    readonly OfficialRegistryPackageEntry[],
  candidate:
    OfficialRegistryPackageEntry
): void {
  let latest:
    OfficialRegistryPackageEntry |
    undefined;

  for (const entry of packages) {
    if (
      entry.packageId !==
        candidate.packageId
    ) {
      continue;
    }

    if (
      entry.version ===
        candidate.version
    ) {
      throw releaseFailure(
        `package version '${candidate.packageId}@${candidate.version}' already exists in the verified registry.`
      );
    }

    if (
      latest === undefined ||
      compareOfficialRegistryPackageEntries(
        latest,
        entry
      ) < 0
    ) {
      latest = entry;
    }
  }

  if (
    latest !== undefined &&
    compareOfficialRegistryPackageEntries(
      latest,
      candidate
    ) >= 0
  ) {
    throw releaseFailure(
      `package version '${candidate.packageId}@${candidate.version}' must advance beyond the registry's latest '${latest.version}' version.`
    );
  }
}

function createUnsignedSnapshot(
  predecessor:
    VerifiedOfficialRegistrySnapshot,
  candidate:
    OfficialRegistryPackageEntry,
  publishedAt: string,
  signingKeyId: string
): UnsignedOfficialRegistrySnapshot {
  if (
    predecessor.snapshot
      .sequence >=
      Number.MAX_SAFE_INTEGER
  ) {
    throw releaseFailure(
      "the registry sequence cannot advance beyond Number.MAX_SAFE_INTEGER."
    );
  }

  if (
    predecessor.snapshot
      .packages.length >=
      OFFICIAL_REGISTRY_MAX_ENTRIES
  ) {
    throw releaseFailure(
      `the registry already contains Aurora's maximum of ${OFFICIAL_REGISTRY_MAX_ENTRIES} package entries.`
    );
  }

  assertVersionAdvances(
    predecessor.snapshot
      .packages,
    candidate
  );

  const packages = [
    ...predecessor.snapshot
      .packages.map(
        cloneRegistryEntry
      ),
    candidate,
  ].sort(
    compareOfficialRegistryPackageEntries
  );

  const parsed =
    parseOfficialRegistrySnapshot({
      registryVersion:
        OFFICIAL_REGISTRY_SCHEMA_VERSION,
      kind:
        OFFICIAL_REGISTRY_KIND,
      sequence:
        predecessor.snapshot
          .sequence + 1,
      publishedAt,
      previousSnapshotDigest:
        predecessor.digest,
      publisherId:
        AURORA_OFFICIAL_PUBLISHER_ID,
      packages,
      signature: {
        version:
          PACKAGE_SIGNATURE_VERSION,
        algorithm:
          PACKAGE_SIGNING_ALGORITHM,
        keyId:
          signingKeyId,
        value:
          PLACEHOLDER_SIGNATURE_VALUE,
      },
    });

  return {
    registryVersion:
      parsed.registryVersion,
    kind:
      parsed.kind,
    sequence:
      parsed.sequence,
    publishedAt:
      parsed.publishedAt,
    previousSnapshotDigest:
      predecessor.digest,
    publisherId:
      AURORA_OFFICIAL_PUBLISHER_ID,
    packages:
      parsed.packages,
    signature: {
      version:
        parsed.signature.version,
      algorithm:
        parsed.signature.algorithm,
      keyId:
        parsed.signature.keyId,
    },
  };
}

function createVerifiedProposal(
  document:
    OfficialRegistryReleaseProposalDocument,
  signingPayload: Buffer
): VerifiedOfficialRegistryReleaseProposal {
  const proposalBytes =
    Buffer.from(
      `${canonicalizeJson(
        document
      )}\n`,
      "utf8"
    );

  const proposal =
    Object.freeze({
      source:
        "verified-official-registry-release-proposal" as const,
      document:
        deepFreeze(document),
      proposalBytes:
        () => Buffer.from(
          proposalBytes
        ),
      signingPayloadBytes:
        () => Buffer.from(
          signingPayload
        ),
    });

  authenticReleaseProposals
    .add(proposal);

  return proposal;
}

export function assertVerifiedOfficialRegistryReleaseProposal(
  value: unknown
): asserts value is
  VerifiedOfficialRegistryReleaseProposal {
  if (
    typeof value !==
      "object" ||
    value === null ||
    !authenticReleaseProposals
      .has(value)
  ) {
    throw new TypeError(
      "Expected an authentic verified official registry release proposal."
    );
  }
}

export class OfficialRegistryReleaseProposalBuilder {
  build(
    predecessor: unknown,
    publication: unknown,
    options:
      OfficialRegistryReleaseProposalOptions
  ): VerifiedOfficialRegistryReleaseProposal {
    assertVerifiedOfficialRegistrySnapshot(
      predecessor
    );

    assertVerifiedPackagePublicationBundle(
      publication
    );

    const signingKeyId =
      options.signingKeyId ??
      AURORA_OFFICIAL_PACKAGE_SIGNING_KEY_ID;

    if (
      !isPackageKeyId(
        signingKeyId
      )
    ) {
      throw releaseFailure(
        "signingKeyId must be a canonical Ed25519 public-key fingerprint."
      );
    }

    assertCanonicalPublishedAt(
      options.publishedAt,
      predecessor.snapshot
        .publishedAt
    );

    const verifiedPublication =
      assertPublicationIntegrity(
        publication
      );

    assertImmutableArchiveUrl(
      options.archiveUrl,
      verifiedPublication.receipt
        .archive.digest
    );

    const entry =
      createRegistryEntry(
        verifiedPublication.receipt,
        options.archiveUrl
      );

    const unsignedSnapshot =
      createUnsignedSnapshot(
        predecessor,
        entry,
        options.publishedAt,
        signingKeyId
      );

    const signingPayload =
      createOfficialRegistrySigningPayload(
        unsignedSnapshot
      );

    const payloadDigest =
      sha256(signingPayload);

    const document:
      OfficialRegistryReleaseProposalDocument =
      {
        proposalVersion:
          OFFICIAL_REGISTRY_RELEASE_PROPOSAL_VERSION,
        kind:
          OFFICIAL_REGISTRY_RELEASE_PROPOSAL_KIND,
        publication: {
          packageId:
            verifiedPublication
              .receipt.packageId,
          version:
            verifiedPublication
              .receipt.version,
          publisherId:
            verifiedPublication
              .receipt.publisherId,
          packageSigningKeyId:
            verifiedPublication
              .receipt.signature!.keyId,
          manifestDigest:
            verifiedPublication
              .receipt.manifestDigest,
          receiptDigest:
            sha256(
              verifiedPublication
                .receiptBytes
            ),
          archive: {
            algorithm:
              "sha256",
            digest:
              verifiedPublication
                .receipt.archive
                .digest,
            size:
              verifiedPublication
                .receipt.archive
                .size,
            url:
              options.archiveUrl,
          },
        },
        predecessor: {
          sequence:
            predecessor.snapshot
              .sequence,
          digest:
            predecessor.digest,
        },
        unsignedSnapshot,
        signing: {
          domain:
            OFFICIAL_REGISTRY_SIGNING_DOMAIN,
          algorithm:
            PACKAGE_SIGNING_ALGORITHM,
          keyId:
            signingKeyId,
          payload: {
            algorithm:
              "sha256",
            encoding:
              "base64",
            digest:
              payloadDigest,
            value:
              signingPayload
                .toString("base64"),
          },
        },
      };

    return createVerifiedProposal(
      document,
      signingPayload
    );
  }
}

function isMissing(
  error: unknown
): boolean {
  return (
    typeof error ===
      "object" &&
    error !== null &&
    "code" in error &&
    error.code ===
      "ENOENT"
  );
}

function sameFileIdentity(
  left: Stats,
  right: Stats
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

async function readExactRegularFile(
  boundary:
    ProjectPathBoundary,
  relativePath: string,
  expected: Buffer
): Promise<Buffer> {
  const file =
    boundary.resolve(
      relativePath
    );

  let handle:
    fs.FileHandle |
    undefined;

  try {
    handle =
      await fs.open(
        file,
        process.platform ===
          "win32"
          ? "r"
          : fsConstants.O_RDONLY |
            fsConstants.O_NOFOLLOW
      );

    const before =
      await handle.stat();

    const pathBefore =
      await fs.lstat(file);

    if (
      !before.isFile() ||
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      !sameFileIdentity(
        before,
        pathBefore
      ) ||
      before.size !==
        expected.byteLength
    ) {
      throw releaseFailure(
        `existing '${relativePath}' is not the expected regular file.`
      );
    }

    const content =
      await handle.readFile();

    const after =
      await handle.stat();

    const pathAfter =
      await fs.lstat(file);

    if (
      !sameFileIdentity(
        before,
        after
      ) ||
      !sameFileIdentity(
        after,
        pathAfter
      ) ||
      before.size !==
        after.size ||
      before.mtimeMs !==
        after.mtimeMs ||
      before.ctimeMs !==
        after.ctimeMs ||
      !content.equals(expected)
    ) {
      throw releaseFailure(
        `existing '${relativePath}' does not match the verified release proposal bytes.`
      );
    }

    return content;
  }
  finally {
    await handle?.close();
  }
}

async function verifyExistingProposal(
  finalPath: string,
  proposalBytes: Buffer,
  signingPayload: Buffer
): Promise<void> {
  const information =
    await fs.lstat(
      finalPath
    );

  if (
    information.isSymbolicLink() ||
    !information.isDirectory()
  ) {
    throw releaseFailure(
      "the content-addressed proposal target exists but is not a safe directory."
    );
  }

  const boundary =
    new ProjectPathBoundary(
      finalPath
    );

  const entries =
    (
      await fs.readdir(
        boundary.projectRoot
      )
    ).sort();

  if (
    entries.length !== 2 ||
    entries[0] !==
      PROPOSAL_FILE_NAME ||
    entries[1] !==
      SIGNING_PAYLOAD_FILE_NAME
  ) {
    throw releaseFailure(
      "the content-addressed proposal target contains unexpected files."
    );
  }

  await Promise.all([
    readExactRegularFile(
      boundary,
      PROPOSAL_FILE_NAME,
      proposalBytes
    ),
    readExactRegularFile(
      boundary,
      SIGNING_PAYLOAD_FILE_NAME,
      signingPayload
    ),
  ]);
}

export class OfficialRegistryReleaseProposalWriter {
  private readonly workspaceBoundary:
    ProjectPathBoundary;

  private readonly proposalDirectory:
    string;

  constructor(
    options:
      OfficialRegistryReleaseProposalWriterOptions
  ) {
    this.workspaceBoundary =
      new ProjectPathBoundary(
        options.workspaceRoot
      );

    this.proposalDirectory =
      options.proposalDirectory ??
      ".aurora/registry-proposals";

    Object.freeze(this);
  }

  async write(
    value: unknown
  ): Promise<
    WrittenOfficialRegistryReleaseProposal
  > {
    assertVerifiedOfficialRegistryReleaseProposal(
      value
    );

    const proposalBytes =
      value.proposalBytes();

    const signingPayload =
      value.signingPayloadBytes();

    const canonicalProposal =
      Buffer.from(
        `${canonicalizeJson(
          value.document
        )}\n`,
        "utf8"
      );

    const expectedPayload =
      Buffer.from(
        value.document.signing
          .payload.value,
        "base64"
      );

    if (
      !proposalBytes.equals(
        canonicalProposal
      ) ||
      !signingPayload.equals(
        expectedPayload
      ) ||
      sha256(signingPayload) !==
        value.document.signing
          .payload.digest
    ) {
      throw releaseFailure(
        "the authentic in-memory proposal no longer matches its canonical signing record."
      );
    }

    const proposalRoot =
      this.workspaceBoundary
        .resolve(
          this.proposalDirectory
        );

    await durableEnsureDirectory(
      proposalRoot
    );

    const proposalBoundary =
      new ProjectPathBoundary(
        proposalRoot
      );

    const relativeFinal =
      `${value.document.unsignedSnapshot.sequence}/${value.document.signing.payload.digest}`;

    const finalPath =
      proposalBoundary.resolve(
        relativeFinal
      );

    try {
      await verifyExistingProposal(
        finalPath,
        proposalBytes,
        signingPayload
      );

      return this.createResult(
        value.document,
        finalPath
      );
    }
    catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }

    await durableEnsureDirectory(
      dirname(finalPath)
    );

    const stagingPath =
      proposalBoundary.resolve(
        `.registry-proposal-${process.pid}-${randomUUID()}.tmp`
      );

    let stagingCreated =
      false;

    try {
      await durableCreateDirectory(
        stagingPath
      );

      stagingCreated = true;

      await durableWriteFile(
        join(
          stagingPath,
          PROPOSAL_FILE_NAME
        ),
        proposalBytes
      );

      await durableWriteFile(
        join(
          stagingPath,
          SIGNING_PAYLOAD_FILE_NAME
        ),
        signingPayload
      );

      try {
        await fs.rename(
          stagingPath,
          finalPath
        );

        stagingCreated =
          false;

        await syncDirectory(
          dirname(finalPath)
        );
      }
      catch (error) {
        if (
          !(
            typeof error ===
              "object" &&
            error !== null &&
            "code" in error &&
            (
              error.code ===
                "EEXIST" ||
              error.code ===
                "ENOTEMPTY" ||
              error.code ===
                "EPERM"
            )
          )
        ) {
          throw error;
        }

        await verifyExistingProposal(
          finalPath,
          proposalBytes,
          signingPayload
        );
      }

      return this.createResult(
        value.document,
        finalPath
      );
    }
    catch (error) {
      if (
        error instanceof
          AuroraError &&
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_PROPOSAL_FAILED
      ) {
        throw error;
      }

      throw releaseFailure(
        "the verified proposal could not be committed atomically.",
        error
      );
    }
    finally {
      if (stagingCreated) {
        try {
          const validated =
            proposalBoundary
              .validateAbsolutePath(
                stagingPath
              );

          await fs.rm(
            validated,
            {
              recursive: true,
              force: true,
            }
          );
        }
        catch {
          // Preserve the primary proposal failure.
        }
      }
    }
  }

  private createResult(
    document:
      OfficialRegistryReleaseProposalDocument,
    proposalPath: string
  ): WrittenOfficialRegistryReleaseProposal {
    return Object.freeze({
      document,
      proposalPath,
      proposalFile:
        join(
          proposalPath,
          PROPOSAL_FILE_NAME
        ),
      signingPayloadFile:
        join(
          proposalPath,
          SIGNING_PAYLOAD_FILE_NAME
        ),
    });
  }
}
