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
  isCanonicalPackageIdentifier,
} from "../manifestSchema.js";

import {
  durableCreateDirectory,
  durableEnsureDirectory,
  durableWriteFile,
  syncDirectory,
} from "../lifecycle/durableFileWriter.js";

import {
  canonicalizeJson,
} from "../trust/packageCanonicalJson.js";

import {
  isPackageKeyId,
  PACKAGE_SIGNATURE_VERSION,
  PACKAGE_SIGNING_ALGORITHM,
} from "../trust/packageTrustTypes.js";

import {
  AURORA_OFFICIAL_PUBLISHER_ID,
} from "../trust/officialPublisherTrust.js";

import {
  OFFICIAL_REGISTRY_RELEASE_PROPOSAL_KIND,
  OFFICIAL_REGISTRY_RELEASE_PROPOSAL_VERSION,
} from "./officialRegistryReleaseProposal.js";

import type {
  OfficialRegistryReleaseProposalDocument,
  UnsignedOfficialRegistrySnapshot,
} from "./officialRegistryReleaseProposal.js";

import {
  OFFICIAL_REGISTRY_KIND,
  OFFICIAL_REGISTRY_SCHEMA_VERSION,
  parseOfficialRegistrySnapshot,
} from "./officialRegistrySchema.js";

import type {
  OfficialRegistryPackageEntry,
  OfficialRegistrySnapshot,
} from "./officialRegistrySchema.js";

import {
  createOfficialRegistrySigningPayload,
  OFFICIAL_REGISTRY_SIGNING_DOMAIN,
} from "./officialRegistrySigningPayload.js";

import {
  assertVerifiedOfficialRegistrySnapshot,
  OfficialRegistryVerifier,
} from "./officialRegistryVerifier.js";

import type {
  OfficialRegistryVerifierOptions,
  VerifiedOfficialRegistrySnapshot,
} from "./officialRegistryVerifier.js";

const SNAPSHOT_FILE_NAME =
  "snapshot.json";

const PLACEHOLDER_SIGNATURE_VALUE =
  Buffer.alloc(64).toString(
    "base64url"
  );

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/u;

const CANONICAL_SIGNATURE_PATTERN =
  /^[A-Za-z0-9_-]{86}$/u;

const authenticFinalizedReleases =
  new WeakSet<object>();

export interface VerifiedOfficialRegistryRelease {
  readonly source:
    "verified-official-registry-release";

  readonly snapshot:
    OfficialRegistrySnapshot;

  readonly digest: string;

  readonly sourceProposalDigest:
    string;

  readonly signingPayloadDigest:
    string;

  readonly snapshotBytes:
    () => Buffer;
}

export interface OfficialRegistryReleaseFinalizerOptions {
  readonly registryVerifierOptions?:
    OfficialRegistryVerifierOptions;
}

export interface OfficialRegistryReleaseWriterOptions {
  readonly workspaceRoot: string;
  readonly releaseDirectory?: string;
}

export interface WrittenOfficialRegistryRelease {
  readonly snapshot:
    OfficialRegistrySnapshot;
  readonly digest: string;
  readonly releasePath: string;
  readonly snapshotFile: string;
}

function finalizationFailure(
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official registry release finalization failed: ${message}`,
    {
      code:
        ErrorCodes
          .REGISTRY_RELEASE_FINALIZATION_FAILED,
      suggestion:
        "Use the canonical proposal directory, the exact offline signing payload, a canonical signature file, and the complete currently trusted registry history.",
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

function assertPlainObject(
  value: unknown,
  name: string
): asserts value is
  Record<string, unknown> {
  if (
    value === null ||
    typeof value !==
      "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !==
      Object.prototype
  ) {
    throw finalizationFailure(
      `${name} must be a plain JSON object.`
    );
  }
}

function assertExactKeys(
  value:
    Record<string, unknown>,
  expected:
    readonly string[],
  name: string
): void {
  const actual =
    Object.keys(value).sort();

  const required =
    [...expected].sort();

  if (
    actual.length !==
      required.length ||
    actual.some(
      (key, index) =>
        key !== required[index]
    )
  ) {
    throw finalizationFailure(
      `${name} contains missing or unexpected fields.`
    );
  }
}

function requireString(
  value: unknown,
  name: string
): string {
  if (
    typeof value !==
      "string" ||
    value.length === 0
  ) {
    throw finalizationFailure(
      `${name} must be a non-empty string.`
    );
  }

  return value;
}

function requireSafeInteger(
  value: unknown,
  name: string
): number {
  if (
    typeof value !==
      "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw finalizationFailure(
      `${name} must be a positive safe integer.`
    );
  }

  return value;
}

function requireSha256(
  value: unknown,
  name: string
): string {
  const digest =
    requireString(
      value,
      name
    );

  if (
    !SHA256_PATTERN.test(
      digest
    )
  ) {
    throw finalizationFailure(
      `${name} must be a lowercase SHA-256 digest.`
    );
  }

  return digest;
}

function requireLiteral<T extends string | number>(
  value: unknown,
  expected: T,
  name: string
): T {
  if (value !== expected) {
    throw finalizationFailure(
      `${name} must equal '${expected}'.`
    );
  }

  return expected;
}

function parseUnsignedSnapshot(
  value: unknown
): UnsignedOfficialRegistrySnapshot {
  assertPlainObject(
    value,
    "proposal.unsignedSnapshot"
  );

  assertExactKeys(
    value,
    [
      "registryVersion",
      "kind",
      "sequence",
      "publishedAt",
      "previousSnapshotDigest",
      "publisherId",
      "packages",
      "signature",
    ],
    "proposal.unsignedSnapshot"
  );

  assertPlainObject(
    value.signature,
    "proposal.unsignedSnapshot.signature"
  );

  assertExactKeys(
    value.signature,
    [
      "version",
      "algorithm",
      "keyId",
    ],
    "proposal.unsignedSnapshot.signature"
  );

  const parsed =
    parseOfficialRegistrySnapshot({
      ...value,
      signature: {
        ...value.signature,
        value:
          PLACEHOLDER_SIGNATURE_VALUE,
      },
    });

  if (
    parsed.publisherId !==
      AURORA_OFFICIAL_PUBLISHER_ID
  ) {
    throw finalizationFailure(
      "the unsigned snapshot is not bound to the Aurora official publisher."
    );
  }

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
      parsed.previousSnapshotDigest as string,
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

function findProposedEntry(
  packages:
    readonly OfficialRegistryPackageEntry[],
  packageId: string,
  version: string
): OfficialRegistryPackageEntry {
  const matches =
    packages.filter(
      entry =>
        entry.packageId ===
          packageId &&
        entry.version ===
          version
    );

  if (matches.length !== 1) {
    throw finalizationFailure(
      "the proposal publication identity does not name exactly one unsigned snapshot entry."
    );
  }

  return matches[0];
}

function parseProposalDocument(
  value: unknown
): OfficialRegistryReleaseProposalDocument {
  assertPlainObject(
    value,
    "proposal"
  );

  assertExactKeys(
    value,
    [
      "proposalVersion",
      "kind",
      "publication",
      "predecessor",
      "unsignedSnapshot",
      "signing",
    ],
    "proposal"
  );

  requireLiteral(
    value.proposalVersion,
    OFFICIAL_REGISTRY_RELEASE_PROPOSAL_VERSION,
    "proposal.proposalVersion"
  );

  requireLiteral(
    value.kind,
    OFFICIAL_REGISTRY_RELEASE_PROPOSAL_KIND,
    "proposal.kind"
  );

  assertPlainObject(
    value.publication,
    "proposal.publication"
  );

  assertExactKeys(
    value.publication,
    [
      "packageId",
      "version",
      "publisherId",
      "packageSigningKeyId",
      "manifestDigest",
      "receiptDigest",
      "archive",
    ],
    "proposal.publication"
  );

  assertPlainObject(
    value.publication.archive,
    "proposal.publication.archive"
  );

  assertExactKeys(
    value.publication.archive,
    [
      "algorithm",
      "digest",
      "size",
      "url",
    ],
    "proposal.publication.archive"
  );

  assertPlainObject(
    value.predecessor,
    "proposal.predecessor"
  );

  assertExactKeys(
    value.predecessor,
    [
      "sequence",
      "digest",
    ],
    "proposal.predecessor"
  );

  assertPlainObject(
    value.signing,
    "proposal.signing"
  );

  assertExactKeys(
    value.signing,
    [
      "domain",
      "algorithm",
      "keyId",
      "payload",
    ],
    "proposal.signing"
  );

  assertPlainObject(
    value.signing.payload,
    "proposal.signing.payload"
  );

  assertExactKeys(
    value.signing.payload,
    [
      "algorithm",
      "encoding",
      "digest",
      "value",
    ],
    "proposal.signing.payload"
  );

  const unsignedSnapshot =
    parseUnsignedSnapshot(
      value.unsignedSnapshot
    );

  const packageId =
    requireString(
      value.publication.packageId,
      "proposal.publication.packageId"
    );

  const version =
    requireString(
      value.publication.version,
      "proposal.publication.version"
    );

  const publisherId =
    requireString(
      value.publication.publisherId,
      "proposal.publication.publisherId"
    );

  if (
    publisherId.length > 128 ||
    !isCanonicalPackageIdentifier(
      publisherId
    )
  ) {
    throw finalizationFailure(
      "proposal.publication.publisherId is not canonical."
    );
  }

  const packageSigningKeyId =
    requireString(
      value.publication.packageSigningKeyId,
      "proposal.publication.packageSigningKeyId"
    );

  if (
    !isPackageKeyId(
      packageSigningKeyId
    )
  ) {
    throw finalizationFailure(
      "proposal.publication.packageSigningKeyId is not canonical."
    );
  }

  const manifestDigest =
    requireSha256(
      value.publication.manifestDigest,
      "proposal.publication.manifestDigest"
    );

  const receiptDigest =
    requireSha256(
      value.publication.receiptDigest,
      "proposal.publication.receiptDigest"
    );

  requireLiteral(
    value.publication.archive.algorithm,
    "sha256",
    "proposal.publication.archive.algorithm"
  );

  const archiveDigest =
    requireSha256(
      value.publication.archive.digest,
      "proposal.publication.archive.digest"
    );

  const archiveSize =
    requireSafeInteger(
      value.publication.archive.size,
      "proposal.publication.archive.size"
    );

  const archiveUrl =
    requireString(
      value.publication.archive.url,
      "proposal.publication.archive.url"
    );

  const predecessorSequence =
    requireSafeInteger(
      value.predecessor.sequence,
      "proposal.predecessor.sequence"
    );

  const predecessorDigest =
    requireSha256(
      value.predecessor.digest,
      "proposal.predecessor.digest"
    );

  requireLiteral(
    value.signing.domain,
    OFFICIAL_REGISTRY_SIGNING_DOMAIN,
    "proposal.signing.domain"
  );

  requireLiteral(
    value.signing.algorithm,
    PACKAGE_SIGNING_ALGORITHM,
    "proposal.signing.algorithm"
  );

  const registrySigningKeyId =
    requireString(
      value.signing.keyId,
      "proposal.signing.keyId"
    );

  if (
    !isPackageKeyId(
      registrySigningKeyId
    )
  ) {
    throw finalizationFailure(
      "proposal.signing.keyId is not canonical."
    );
  }

  requireLiteral(
    value.signing.payload.algorithm,
    "sha256",
    "proposal.signing.payload.algorithm"
  );

  requireLiteral(
    value.signing.payload.encoding,
    "base64",
    "proposal.signing.payload.encoding"
  );

  const payloadDigest =
    requireSha256(
      value.signing.payload.digest,
      "proposal.signing.payload.digest"
    );

  const payloadValue =
    requireString(
      value.signing.payload.value,
      "proposal.signing.payload.value"
    );

  const payloadBytes =
    Buffer.from(
      payloadValue,
      "base64"
    );

  if (
    payloadBytes.byteLength === 0 ||
    payloadBytes
      .toString("base64") !==
        payloadValue ||
    sha256(payloadBytes) !==
      payloadDigest
  ) {
    throw finalizationFailure(
      "proposal.signing.payload is not canonical or does not match its digest."
    );
  }

  if (
    unsignedSnapshot.registryVersion !==
      OFFICIAL_REGISTRY_SCHEMA_VERSION ||
    unsignedSnapshot.kind !==
      OFFICIAL_REGISTRY_KIND ||
    unsignedSnapshot.signature.version !==
      PACKAGE_SIGNATURE_VERSION ||
    unsignedSnapshot.signature.algorithm !==
      PACKAGE_SIGNING_ALGORITHM ||
    unsignedSnapshot.signature.keyId !==
      registrySigningKeyId
  ) {
    throw finalizationFailure(
      "the unsigned snapshot signature metadata does not match the proposal signing record."
    );
  }

  if (
    unsignedSnapshot.sequence !==
      predecessorSequence + 1 ||
    unsignedSnapshot.previousSnapshotDigest !==
      predecessorDigest
  ) {
    throw finalizationFailure(
      "the unsigned snapshot does not advance exactly from the proposal predecessor."
    );
  }

  const proposedEntry =
    findProposedEntry(
      unsignedSnapshot.packages,
      packageId,
      version
    );

  if (
    proposedEntry.manifestDigest !==
      manifestDigest ||
    proposedEntry.archive.algorithm !==
      "sha256" ||
    proposedEntry.archive.digest !==
      archiveDigest ||
    proposedEntry.archive.size !==
      archiveSize ||
    proposedEntry.archive.url !==
      archiveUrl
  ) {
    throw finalizationFailure(
      "the proposal publication evidence does not match its unsigned registry entry."
    );
  }

  return {
    proposalVersion:
      OFFICIAL_REGISTRY_RELEASE_PROPOSAL_VERSION,
    kind:
      OFFICIAL_REGISTRY_RELEASE_PROPOSAL_KIND,
    publication: {
      packageId,
      version,
      publisherId,
      packageSigningKeyId,
      manifestDigest,
      receiptDigest,
      archive: {
        algorithm:
          "sha256",
        digest:
          archiveDigest,
        size:
          archiveSize,
        url:
          archiveUrl,
      },
    },
    predecessor: {
      sequence:
        predecessorSequence,
      digest:
        predecessorDigest,
    },
    unsignedSnapshot,
    signing: {
      domain:
        OFFICIAL_REGISTRY_SIGNING_DOMAIN,
      algorithm:
        PACKAGE_SIGNING_ALGORITHM,
      keyId:
        registrySigningKeyId,
      payload: {
        algorithm:
          "sha256",
        encoding:
          "base64",
        digest:
          payloadDigest,
        value:
          payloadValue,
      },
    },
  };
}

function assertProposalMatchesPredecessor(
  proposal:
    OfficialRegistryReleaseProposalDocument,
  predecessor:
    VerifiedOfficialRegistrySnapshot
): void {
  if (
    proposal.predecessor.sequence !==
      predecessor.snapshot.sequence ||
    proposal.predecessor.digest !==
      predecessor.digest ||
    proposal.unsignedSnapshot.sequence !==
      predecessor.snapshot.sequence + 1 ||
    proposal.unsignedSnapshot.previousSnapshotDigest !==
      predecessor.digest
  ) {
    throw finalizationFailure(
      "the proposal is stale or does not advance from the currently verified registry predecessor."
    );
  }
}

function parseCanonicalSignature(
  value: string
): string {
  if (
    !CANONICAL_SIGNATURE_PATTERN.test(
      value
    )
  ) {
    throw finalizationFailure(
      "the offline signature is not a canonical unpadded base64url 64-byte Ed25519 signature."
    );
  }

  const bytes =
    Buffer.from(
      value,
      "base64url"
    );

  if (
    bytes.byteLength !== 64 ||
    bytes.toString(
      "base64url"
    ) !== value
  ) {
    throw finalizationFailure(
      "the offline signature is not a canonical unpadded base64url 64-byte Ed25519 signature."
    );
  }

  return value;
}

function createVerifiedRelease(
  verified:
    VerifiedOfficialRegistrySnapshot,
  proposalBytes: Buffer,
  signingPayload: Buffer
): VerifiedOfficialRegistryRelease {
  const snapshotBytes =
    Buffer.from(
      `${canonicalizeJson(
        verified.snapshot
      )}\n`,
      "utf8"
    );

  const release =
    Object.freeze({
      source:
        "verified-official-registry-release" as const,
      snapshot:
        verified.snapshot,
      digest:
        verified.digest,
      sourceProposalDigest:
        sha256(proposalBytes),
      signingPayloadDigest:
        sha256(signingPayload),
      snapshotBytes:
        () => Buffer.from(
          snapshotBytes
        ),
    });

  authenticFinalizedReleases.add(
    release
  );

  return release;
}

export function assertVerifiedOfficialRegistryRelease(
  value: unknown
): asserts value is
  VerifiedOfficialRegistryRelease {
  if (
    typeof value !==
      "object" ||
    value === null ||
    !authenticFinalizedReleases
      .has(value)
  ) {
    throw new TypeError(
      "Expected an authentic verified official registry release."
    );
  }
}

export class OfficialRegistryReleaseFinalizer {
  private readonly verifier:
    OfficialRegistryVerifier;

  constructor(
    options:
      OfficialRegistryReleaseFinalizerOptions = {}
  ) {
    this.verifier =
      new OfficialRegistryVerifier(
        options.registryVerifierOptions
      );

    Object.freeze(this);
  }

  finalize(
    predecessor: unknown,
    proposalValue: unknown,
    proposalBytes: Buffer,
    signingPayload: Buffer,
    signatureValue: string
  ): VerifiedOfficialRegistryRelease {
    try {
      assertVerifiedOfficialRegistrySnapshot(
        predecessor
      );

      const proposal =
        parseProposalDocument(
          proposalValue
        );

      const canonicalProposal =
        Buffer.from(
          `${canonicalizeJson(
            proposal
          )}\n`,
          "utf8"
        );

      if (
        !proposalBytes.equals(
          canonicalProposal
        )
      ) {
        throw finalizationFailure(
          "proposal.json is not the exact canonical proposal document."
        );
      }

      assertProposalMatchesPredecessor(
        proposal,
        predecessor
      );

      const expectedPayload =
        createOfficialRegistrySigningPayload(
          proposal.unsignedSnapshot
        );

      const embeddedPayload =
        Buffer.from(
          proposal.signing.payload.value,
          "base64"
        );

      if (
        !signingPayload.equals(
          expectedPayload
        ) ||
        !embeddedPayload.equals(
          expectedPayload
        ) ||
        sha256(expectedPayload) !==
          proposal.signing.payload.digest
      ) {
        throw finalizationFailure(
          "the supplied signing payload does not exactly match the canonical unsigned snapshot."
        );
      }

      const signature =
        parseCanonicalSignature(
          signatureValue
        );

      const candidate =
        parseOfficialRegistrySnapshot({
          ...proposal.unsignedSnapshot,
          signature: {
            ...proposal.unsignedSnapshot
              .signature,
            value:
              signature,
          },
        });

      const verified =
        this.verifier.verify(
          candidate,
          predecessor
        );

      return createVerifiedRelease(
        verified,
        proposalBytes,
        signingPayload
      );
    }
    catch (error) {
      if (
        error instanceof
          AuroraError &&
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_FINALIZATION_FAILED
      ) {
        throw error;
      }

      throw finalizationFailure(
        "the offline signature did not produce a trusted successor snapshot.",
        error
      );
    }
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

async function verifyExactSnapshotFile(
  finalPath: string,
  expected: Buffer
): Promise<void> {
  const information =
    await fs.lstat(
      finalPath
    );

  if (
    information.isSymbolicLink() ||
    !information.isDirectory()
  ) {
    throw finalizationFailure(
      "the content-addressed release target exists but is not a safe directory."
    );
  }

  const boundary =
    new ProjectPathBoundary(
      finalPath
    );

  const entries =
    await fs.readdir(
      boundary.projectRoot
    );

  if (
    entries.length !== 1 ||
    entries[0] !==
      SNAPSHOT_FILE_NAME
  ) {
    throw finalizationFailure(
      "the content-addressed release target contains unexpected files."
    );
  }

  const snapshotFile =
    boundary.resolve(
      SNAPSHOT_FILE_NAME
    );

  let handle:
    fs.FileHandle |
    undefined;

  try {
    handle =
      await fs.open(
        snapshotFile,
        process.platform ===
          "win32"
          ? "r"
          : fsConstants.O_RDONLY |
            fsConstants.O_NOFOLLOW
      );

    const before =
      await handle.stat();

    const pathBefore =
      await fs.lstat(
        snapshotFile
      );

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
      throw finalizationFailure(
        "the existing snapshot is not the expected regular file."
      );
    }

    const content =
      await handle.readFile();

    const after =
      await handle.stat();

    const pathAfter =
      await fs.lstat(
        snapshotFile
      );

    if (
      !sameFileIdentity(
        before,
        after
      ) ||
      !sameFileIdentity(
        after,
        pathAfter
      ) ||
      before.size !== after.size ||
      before.mtimeMs !==
        after.mtimeMs ||
      before.ctimeMs !==
        after.ctimeMs ||
      !content.equals(expected)
    ) {
      throw finalizationFailure(
        "the existing snapshot does not match the verified release bytes."
      );
    }
  }
  finally {
    await handle?.close();
  }
}

export class OfficialRegistryReleaseWriter {
  private readonly workspaceBoundary:
    ProjectPathBoundary;

  private readonly releaseDirectory:
    string;

  constructor(
    options:
      OfficialRegistryReleaseWriterOptions
  ) {
    this.workspaceBoundary =
      new ProjectPathBoundary(
        options.workspaceRoot
      );

    this.releaseDirectory =
      options.releaseDirectory ??
      ".aurora/registry-releases";

    Object.freeze(this);
  }

  async write(
    value: unknown
  ): Promise<
    WrittenOfficialRegistryRelease
  > {
    assertVerifiedOfficialRegistryRelease(
      value
    );

    const snapshotBytes =
      value.snapshotBytes();

    const canonicalSnapshot =
      Buffer.from(
        `${canonicalizeJson(
          value.snapshot
        )}\n`,
        "utf8"
      );

    if (
      !snapshotBytes.equals(
        canonicalSnapshot
      )
    ) {
      throw finalizationFailure(
        "the authentic in-memory release no longer matches its canonical snapshot."
      );
    }

    const releaseRoot =
      this.workspaceBoundary.resolve(
        this.releaseDirectory
      );

    await durableEnsureDirectory(
      releaseRoot
    );

    const releaseBoundary =
      new ProjectPathBoundary(
        releaseRoot
      );

    const relativeFinal =
      `${value.snapshot.sequence}/${value.digest}`;

    const finalPath =
      releaseBoundary.resolve(
        relativeFinal
      );

    try {
      await verifyExactSnapshotFile(
        finalPath,
        snapshotBytes
      );

      return this.createResult(
        value,
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
      releaseBoundary.resolve(
        `.registry-release-${process.pid}-${randomUUID()}.tmp`
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
          SNAPSHOT_FILE_NAME
        ),
        snapshotBytes
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

        await verifyExactSnapshotFile(
          finalPath,
          snapshotBytes
        );
      }

      return this.createResult(
        value,
        finalPath
      );
    }
    catch (error) {
      if (
        error instanceof
          AuroraError &&
        error.code ===
          ErrorCodes
            .REGISTRY_RELEASE_FINALIZATION_FAILED
      ) {
        throw error;
      }

      throw finalizationFailure(
        "the verified signed snapshot could not be committed atomically.",
        error
      );
    }
    finally {
      if (stagingCreated) {
        try {
          const validated =
            releaseBoundary
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
          // Preserve the primary finalization failure.
        }
      }
    }
  }

  private createResult(
    value:
      VerifiedOfficialRegistryRelease,
    releasePath: string
  ): WrittenOfficialRegistryRelease {
    return Object.freeze({
      snapshot:
        value.snapshot,
      digest:
        value.digest,
      releasePath,
      snapshotFile:
        join(
          releasePath,
          SNAPSHOT_FILE_NAME
        ),
    });
  }
}
