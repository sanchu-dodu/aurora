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

import type {
  PackageExecutionPolicy,
} from "../execution/packageCapabilityPolicy.js";

import type {
  PackageEnvironmentValueProvider,
} from "../execution/packageEnvironmentBroker.js";

import {
  LockManager,
} from "../lock/lockManager.js";

import type {
  LockFile,
  OfficialRegistryPackageLockEntry,
} from "../lock/lockSchema.js";

import {
  PackageTrustPolicy,
} from "../trust/packageTrustPolicy.js";

import type {
  PackageTrustPolicyOptions,
} from "../trust/packageTrustPolicy.js";

import {
  satisfiesManifestVersionRange,
} from "../version/manifestVersion.js";

import {
  OfficialRegistryArtifactCache,
} from "./officialRegistryArtifactCache.js";

import {
  OfficialRegistryArtifactExtractor,
} from "./officialRegistryArtifactExtractor.js";

import type {
  ExtractedOfficialRegistryArtifact,
} from "./officialRegistryArtifactExtractor.js";

import type {
  OfficialRegistryCatalogOptions,
} from "./officialRegistryCatalog.js";

import {
  OfficialRegistryPackageInstaller,
} from "./officialRegistryPackageInstaller.js";

import {
  OfficialRegistryPackageLocker,
} from "./officialRegistryPackageLocker.js";

export interface OfficialRegistryOfflinePackageInstallerOptions {
  readonly projectRoot: string;
  readonly cacheRoot: string;
  readonly extractionRoot: string;
  readonly registryOptions?:
    OfficialRegistryCatalogOptions;
  readonly maxArchiveBytes?: number;
  readonly maxExtractedBytes?: number;
  readonly maxEntries?: number;
  readonly trust?:
    PackageTrustPolicyOptions;
  readonly executionPolicy?:
    PackageExecutionPolicy;
  readonly environmentProvider?:
    PackageEnvironmentValueProvider;
}

function offlineIntegrityFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}' offline installation failed verification: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED,
      suggestion:
        "Restore the exact authenticated lockfile and verified cache entries before retrying offline installation.",
      cause,
    }
  );
}

function offlineCacheMiss(
  packageId: string,
  version: string
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}@${version}' is not present in the verified offline cache.`,
    {
      code:
        ErrorCodes
          .PACKAGE_ARTIFACT_CACHE_FAILED,
      suggestion:
        "Acquire and verify the exact locked archive while online, then retry the locked installation offline.",
    }
  );
}

function requireOfficialEntry(
  lockFile: LockFile,
  packageId: string,
  parentPackageId?: string
): OfficialRegistryPackageLockEntry {
  const entry =
    lockFile.packages[
      packageId
    ];

  if (
    entry === undefined ||
    typeof entry === "string"
  ) {
    throw offlineIntegrityFailure(
      packageId,
      parentPackageId === undefined
        ? "aurora.lock does not contain a full official registry identity for the requested package."
        : `aurora.lock does not contain a full official registry identity required by '${parentPackageId}'.`
    );
  }

  return entry;
}

export class OfficialRegistryOfflinePackageInstaller {
  private readonly projectRoot:
    string;

  private readonly extractionBoundary:
    ProjectPathBoundary;

  private readonly cache:
    OfficialRegistryArtifactCache;

  private readonly extractor:
    OfficialRegistryArtifactExtractor;

  private readonly locker:
    OfficialRegistryPackageLocker;

  private readonly installer:
    OfficialRegistryPackageInstaller;

  private readonly trustPolicy:
    PackageTrustPolicy;

  constructor(
    value: unknown,
    options:
      OfficialRegistryOfflinePackageInstallerOptions
  ) {
    this.projectRoot =
      new ProjectPathBoundary(
        options.projectRoot
      ).projectRoot;

    this.extractionBoundary =
      new ProjectPathBoundary(
        options.extractionRoot
      );

    this.cache =
      new OfficialRegistryArtifactCache(
        value,
        options.cacheRoot,
        {
          registryOptions:
            options.registryOptions,
          maxArchiveBytes:
            options.maxArchiveBytes,
        }
      );

    this.extractor =
      new OfficialRegistryArtifactExtractor(
        value,
        this.extractionBoundary
          .projectRoot,
        {
          registryOptions:
            options.registryOptions,
          maxExtractedBytes:
            options.maxExtractedBytes,
          maxEntries:
            options.maxEntries,
        }
      );

    this.locker =
      new OfficialRegistryPackageLocker(
        value,
        this.projectRoot,
        {
          registryOptions:
            options.registryOptions,
        }
      );

    this.installer =
      new OfficialRegistryPackageInstaller({
        projectRoot:
          this.projectRoot,
        trust:
          options.trust,
        executionPolicy:
          options.executionPolicy,
        environmentProvider:
          options.environmentProvider,
      });

    this.trustPolicy =
      new PackageTrustPolicy(
        options.trust
      );

    Object.freeze(this);
  }

  async install(
    packageId: string
  ): Promise<void> {
    const lockFile =
      await new LockManager(
        this.projectRoot
      ).read();

    requireOfficialEntry(
      lockFile,
      packageId
    );

    const extracted =
      new Map<
        string,
        ExtractedOfficialRegistryArtifact
      >();

    const visiting =
      new Set<string>();

    const installationOrder:
      string[] = [];

    let primaryFailure:
      unknown;

    try {
      const visit =
        async (
          currentPackageId: string,
          parentPackageId?: string,
          requiredRange?: string
        ): Promise<void> => {
          const lockedEntry =
            requireOfficialEntry(
              lockFile,
              currentPackageId,
              parentPackageId
            );

          if (
            requiredRange !==
              undefined &&
            !satisfiesManifestVersionRange(
              lockedEntry.version,
              requiredRange
            )
          ) {
            throw new AuroraError(
              `Official package '${parentPackageId}' requires '${currentPackageId}' ${requiredRange}, but aurora.lock selects ${lockedEntry.version}.`,
              {
                code:
                  ErrorCodes
                    .PACKAGE_INCOMPATIBLE,
                suggestion:
                  "Regenerate aurora.lock from a dependency set that satisfies every authenticated manifest constraint.",
              }
            );
          }

          if (
            visiting.has(
              currentPackageId
            )
          ) {
            throw new AuroraError(
              `Official package dependency graph contains a cycle through '${currentPackageId}'.`,
              {
                code:
                  ErrorCodes
                    .PACKAGE_INCOMPATIBLE,
                suggestion:
                  "Restore an acyclic authenticated dependency lock set.",
              }
            );
          }

          if (
            extracted.has(
              currentPackageId
            )
          ) {
            return;
          }

          visiting.add(
            currentPackageId
          );

          let cached;

          try {
            cached =
              await this.cache.get(
                currentPackageId,
                {
                  kind:
                    "exact",
                  version:
                    lockedEntry.version,
                }
              );
          }
          catch (error) {
            throw offlineIntegrityFailure(
              currentPackageId,
              "the signed registry no longer authenticates the exact locked version and archive identity.",
              error
            );
          }

          if (cached === undefined) {
            throw offlineCacheMiss(
              currentPackageId,
              lockedEntry.version
            );
          }

          const candidate =
            await this.extractor
              .extract(cached);

          extracted.set(
            currentPackageId,
            candidate
          );

          this.trustPolicy.verify(
            candidate.manifest
          );

          for (
            const dependency
            of candidate.manifest
              .dependencies
          ) {
            const dependencyEntry =
              lockFile.packages[
                dependency.id
              ];

            if (
              dependency.optional &&
              dependencyEntry ===
                undefined
            ) {
              continue;
            }

            await visit(
              dependency.id,
              currentPackageId,
              dependency.version
            );
          }

          visiting.delete(
            currentPackageId
          );
          installationOrder.push(
            currentPackageId
          );
        };

      await visit(packageId);

      const lockedSet =
        await this.locker
          .bindExistingSet(
            installationOrder.map(
              currentPackageId => {
                const candidate =
                  extracted.get(
                    currentPackageId
                  );

                if (
                  candidate ===
                    undefined
                ) {
                  throw offlineIntegrityFailure(
                    currentPackageId,
                    "the authenticated extraction disappeared before lock binding."
                  );
                }

                return candidate;
              }
            )
          );

      const requested =
        lockedSet.find(
          locked =>
            locked.entry
              .packageId ===
                packageId
        );

      if (requested === undefined) {
        throw offlineIntegrityFailure(
          packageId,
          "the requested package disappeared from the authenticated lock set."
        );
      }

      await this.installer
        .installSet(
          requested,
          lockedSet.filter(
            locked =>
              locked !== requested
          )
        );
    }
    catch (error) {
      primaryFailure = error;
    }

    let cleanupFailure:
      unknown;

    for (
      const candidate
      of extracted.values()
    ) {
      try {
        const stagingPath =
          this.extractionBoundary
            .validateAbsolutePath(
              candidate.stagingPath
            );

        if (
          stagingPath ===
            this.extractionBoundary
              .projectRoot
        ) {
          throw new Error(
            "Refusing to remove the extraction root."
          );
        }

        await fs.rm(
          stagingPath,
          {
            recursive:
              true,
            force:
              true,
          }
        );
      }
      catch (error) {
        cleanupFailure ??= error;
      }
    }

    if (primaryFailure !== undefined) {
      throw primaryFailure;
    }

    if (cleanupFailure !== undefined) {
      throw new AuroraError(
        "Official package offline installation completed, but authenticated extraction cleanup failed.",
        {
          code:
            ErrorCodes
              .PACKAGE_EXTRACTION_FAILED,
          suggestion:
            "Inspect the private extraction directory and remove only the verified temporary staging paths.",
          cause:
            cleanupFailure,
        }
      );
    }
  }
}
