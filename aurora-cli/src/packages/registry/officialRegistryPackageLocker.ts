import {
  createHash,
} from "node:crypto";

import {
  constants as fsConstants,
} from "node:fs";

import fs from "node:fs/promises";

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
  PackageArtifactVerifier,
} from "../integrity/packageArtifactVerifier.js";

import {
  LockManager,
} from "../lock/lockManager.js";

import {
  parseOfficialRegistryPackageLockEntry,
} from "../lock/lockSchema.js";

import type {
  OfficialRegistryPackageLockEntry,
} from "../lock/lockSchema.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  validatePackage,
} from "../packageValidator.js";

import {
  parsePackageManifestBytes,
} from "../trust/packageManifestJson.js";

import type {
  OfficialRegistryCatalogOptions,
} from "./officialRegistryCatalog.js";

import {
  assertExtractedOfficialRegistryArtifact,
} from "./officialRegistryArtifactExtractor.js";

import type {
  ExtractedOfficialRegistryArtifact,
} from "./officialRegistryArtifactExtractor.js";

import {
  OfficialRegistryResolver,
} from "./officialRegistryResolver.js";

import type {
  ResolvedOfficialRegistryPackage,
} from "./officialRegistryResolver.js";

import type {
  OfficialRegistryPackageEntry,
} from "./officialRegistrySchema.js";

const verifiedLocks =
  new WeakSet<object>();

export interface OfficialRegistryPackageLockerOptions {
  readonly registryOptions?:
    OfficialRegistryCatalogOptions;
}

export interface LockedOfficialRegistryPackage {
  readonly source:
    "verified-lock";
  readonly projectRoot: string;
  readonly resolved:
    ResolvedOfficialRegistryPackage;
  readonly entry:
    OfficialRegistryPackageLockEntry;
  readonly extracted:
    ExtractedOfficialRegistryArtifact;
}

function lockIntegrityFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}' lock identity failed verification: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED,
      suggestion:
        "Reject the lock update and repeat resolution, acquisition, caching, and extraction from the current signed registry.",
      cause,
    }
  );
}

function assertSameEntryIdentity(
  expected:
    OfficialRegistryPackageEntry,
  received:
    OfficialRegistryPackageEntry
): void {
  if (
    expected.packageId !== received.packageId ||
    expected.version !== received.version ||
    expected.manifestDigest !== received.manifestDigest ||
    expected.archive.algorithm !== received.archive.algorithm ||
    expected.archive.digest !== received.archive.digest ||
    expected.archive.size !== received.archive.size ||
    expected.archive.url !== received.archive.url ||
    expected.provenance.type !== received.provenance.type ||
    expected.provenance.url !== received.provenance.url ||
    expected.provenance.reference !== received.provenance.reference ||
    expected.lifecycle.status !== received.lifecycle.status ||
    expected.lifecycle.reason !== received.lifecycle.reason
  ) {
    throw lockIntegrityFailure(
      expected.packageId,
      "the extraction receipt does not match the locker's authenticated registry identity."
    );
  }
}

async function openRegularFile(
  file: string,
  packageId: string
): Promise<fs.FileHandle> {
  const handle =
    await fs.open(
      file,
      process.platform === "win32"
        ? "r"
        : fsConstants.O_RDONLY |
          fsConstants.O_NOFOLLOW
    );

  try {
    const [
      openedInformation,
      pathInformation,
    ] =
      await Promise.all([
        handle.stat(),
        fs.lstat(file),
      ]);

    if (
      pathInformation.isSymbolicLink() ||
      !pathInformation.isFile() ||
      !openedInformation.isFile() ||
      pathInformation.dev !== openedInformation.dev ||
      pathInformation.ino !== openedInformation.ino
    ) {
      throw lockIntegrityFailure(
        packageId,
        "manifest.json is not the same regular file that was opened."
      );
    }

    return handle;
  }
  catch (error) {
    await handle.close();
    throw error;
  }
}

function createLockEntry(
  resolved:
    ResolvedOfficialRegistryPackage,
  manifest:
    PackageManifest
): OfficialRegistryPackageLockEntry {
  return freezeJson(
    parseOfficialRegistryPackageLockEntry({
      lockVersion:
        1,
      source:
        "official-registry",
      packageId:
        resolved.entry.packageId,
      version:
        resolved.entry.version,
      registry: {
        sequence:
          resolved.registrySequence,
        digest:
          resolved.registryDigest,
      },
      manifest: {
        algorithm:
          "sha256",
        digest:
          resolved.entry.manifestDigest,
      },
      archive: {
        algorithm:
          resolved.entry.archive.algorithm,
        digest:
          resolved.entry.archive.digest,
        size:
          resolved.entry.archive.size,
        url:
          resolved.entry.archive.url,
      },
      provenance: {
        type:
          resolved.entry.provenance.type,
        url:
          resolved.entry.provenance.url,
        reference:
          resolved.entry.provenance.reference,
      },
      publisher: {
        id:
          manifest.publisher.id,
        signatureKeyId:
          manifest.signature
            ?.keyId ??
          null,
      },
      packageArtifact: {
        algorithm:
          manifest.artifact.algorithm,
        digest:
          manifest.artifact.digest,
      },
    })
  );
}

function freezeJson<T>(
  value: T
): Readonly<T> {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child
    of Object.values(value)
  ) {
    freezeJson(child);
  }

  return Object.freeze(value);
}

function createLockedReceipt(
  projectRoot: string,
  resolved:
    ResolvedOfficialRegistryPackage,
  entry:
    OfficialRegistryPackageLockEntry,
  extracted:
    ExtractedOfficialRegistryArtifact
): LockedOfficialRegistryPackage {
  const receipt:
    LockedOfficialRegistryPackage =
      Object.freeze({
        source:
          "verified-lock",
        projectRoot,
        resolved,
        entry,
        extracted,
      });

  verifiedLocks.add(receipt);
  return receipt;
}

export function assertLockedOfficialRegistryPackage(
  value: unknown
): asserts value is
  LockedOfficialRegistryPackage {
  if (
    typeof value !== "object" ||
    value === null ||
    !verifiedLocks.has(value)
  ) {
    throw new TypeError(
      "Expected an authentic locked official registry package receipt."
    );
  }
}

export class OfficialRegistryPackageLocker {
  private readonly projectRoot:
    string;

  private readonly registryResolver:
    OfficialRegistryResolver;

  private readonly lockManager:
    LockManager;

  constructor(
    value: unknown,
    projectRoot: string,
    options:
      OfficialRegistryPackageLockerOptions = {}
  ) {
    this.projectRoot =
      new ProjectPathBoundary(
        projectRoot
      ).projectRoot;

    this.registryResolver =
      new OfficialRegistryResolver(
        value,
        options.registryOptions
      );

    this.lockManager =
      new LockManager(
        this.projectRoot
      );

    Object.freeze(this);
  }

  async lock(
    extracted:
      ExtractedOfficialRegistryArtifact
  ):
    Promise<
      LockedOfficialRegistryPackage
    > {
    assertExtractedOfficialRegistryArtifact(
      extracted
    );

    const packageId =
      extracted.resolved
        .entry.packageId;

    let resolved:
      ResolvedOfficialRegistryPackage;

    try {
      resolved =
        this.registryResolver
          .resolve(
            packageId,
            {
              kind:
                "exact",
              version:
                extracted.resolved
                  .entry.version,
            }
          );
    }
    catch (error) {
      throw lockIntegrityFailure(
        packageId,
        "the current signed registry no longer authorizes the extracted package version.",
        error
      );
    }

    assertSameEntryIdentity(
      resolved.entry,
      extracted.resolved.entry
    );

    let manifestHandle:
      fs.FileHandle |
      undefined;

    try {
      const stagingBoundary =
        new ProjectPathBoundary(
          extracted.stagingPath
        );

      const packagePath =
        stagingBoundary.resolve(
          packageId
        );

      if (
        packagePath !==
          extracted.packagePath
      ) {
        throw lockIntegrityFailure(
          packageId,
          "the extraction receipt package path changed before lock publication."
        );
      }

      const packageBoundary =
        new ProjectPathBoundary(
          packagePath
        );

      const manifestPath =
        packageBoundary.resolve(
          "manifest.json"
        );

      if (
        manifestPath !==
          extracted.manifestPath
      ) {
        throw lockIntegrityFailure(
          packageId,
          "the extraction receipt manifest path changed before lock publication."
        );
      }

      manifestHandle =
        await openRegularFile(
          manifestPath,
          packageId
        );

      const manifestBytes =
        await manifestHandle
          .readFile();

      if (
        createHash("sha256")
          .update(manifestBytes)
          .digest("hex") !==
        resolved.entry
          .manifestDigest
      ) {
        throw lockIntegrityFailure(
          packageId,
          "manifest.json no longer matches the digest authenticated by the official registry."
        );
      }

      let manifest:
        PackageManifest;

      try {
        manifest =
          validatePackage(
            parsePackageManifestBytes(
              manifestBytes
            ),
            "official registry lock manifest.json"
          );
      }
      catch (error) {
        throw lockIntegrityFailure(
          packageId,
          "manifest.json is no longer a valid unambiguous Package Manifest v1 document.",
          error
        );
      }

      if (
        manifest.id !== packageId ||
        manifest.version !==
          resolved.entry.version
      ) {
        throw lockIntegrityFailure(
          packageId,
          "manifest.json identity no longer matches the current signed registry entry."
        );
      }

      await new PackageArtifactVerifier()
        .verify(
          stagingBoundary.projectRoot,
          manifest
        );

      const entry =
        createLockEntry(
          resolved,
          manifest
        );

      await this.lockManager
        .registerOfficial(
          packageId,
          entry
        );

      const persisted =
        (
          await this.lockManager
            .read()
        ).packages[packageId];

      if (
        typeof persisted === "string" ||
        JSON.stringify(persisted) !==
          JSON.stringify(entry)
      ) {
        throw lockIntegrityFailure(
          packageId,
          "the verified official lock entry did not persist exactly."
        );
      }

      return createLockedReceipt(
        this.projectRoot,
        resolved,
        entry,
        extracted
      );
    }
    catch (error) {
      if (
        error instanceof AuroraError &&
        error.code ===
          ErrorCodes
            .PACKAGE_INTEGRITY_FAILED
      ) {
        throw error;
      }

      throw lockIntegrityFailure(
        packageId,
        "the extracted package could not be safely bound to aurora.lock.",
        error
      );
    }
    finally {
      await manifestHandle
        ?.close();
    }
  }
}
