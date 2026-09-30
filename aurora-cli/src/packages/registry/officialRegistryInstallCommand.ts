import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuroraError } from "../../errors/AuroraError.js";
import { ErrorCodes } from "../../errors/errorCodes.js";
import { ProjectPathBoundary } from "../../security/projectPathBoundary.js";
import { CompatibilityChecker } from "../compatibility/compatibilityChecker.js";
import { CacheManager } from "../cache/cacheManager.js";
import { InstalledStateVerifier } from "../verify/installedStateVerifier.js";
import { PackageCapabilityPolicy } from "../execution/packageCapabilityPolicy.js";
import { LockManager } from "../lock/lockManager.js";
import { ProjectLifecycleLock } from "../lifecycle/projectLifecycleLock.js";
import { LifecycleRecoveryManager } from "../lifecycle/lifecycleRecoveryManager.js";
import { assertCanonicalPackageIdentifier } from "../packageValidator.js";
import { PackageTrustPolicy } from "../trust/packageTrustPolicy.js";
import {
  isManifestSemVer,
  isManifestVersionRange,
  satisfiesManifestVersionRange,
} from "../version/manifestVersion.js";
import { OfficialRegistryActiveReader } from "./officialRegistryActiveReader.js";
import { OfficialRegistryArtifactAcquirer } from "./officialRegistryArtifactAcquirer.js";
import type {
  OfficialRegistryArtifactAddressResolver,
  OfficialRegistryArtifactTransport,
} from "./officialRegistryArtifactAcquirer.js";
import { OfficialRegistryArtifactCache } from "./officialRegistryArtifactCache.js";
import {
  OfficialRegistryArtifactExtractor,
  OFFICIAL_REGISTRY_EXTRACTION_MAX_BYTES,
  OFFICIAL_REGISTRY_EXTRACTION_MAX_ENTRIES,
} from "./officialRegistryArtifactExtractor.js";
import type { ExtractedOfficialRegistryArtifact } from "./officialRegistryArtifactExtractor.js";
import { OfficialRegistryPackageInstaller } from "./officialRegistryPackageInstaller.js";
import { OfficialRegistryPackageLocker } from "./officialRegistryPackageLocker.js";
import type { LockedOfficialRegistryPackage } from "./officialRegistryPackageLocker.js";
import { OfficialRegistryResolver } from "./officialRegistryResolver.js";
import type { OfficialRegistryActiveCommandDependencies } from "./officialRegistryActiveCommand.js";
import type { OfficialRegistryPackageInstallerOptions } from "./officialRegistryPackageInstaller.js";
import type { OfficialRegistryVersionSelector } from "./officialRegistryResolver.js";

export const OFFICIAL_INSTALL_MAX_PACKAGES = 64;
export const OFFICIAL_INSTALL_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

export interface InstallActiveOfficialRegistryPackageOptions {
  readonly registryDigest: string;
  readonly version?: string;
  readonly range?: string;
  readonly offline?: boolean;
}

export interface OfficialRegistryInstallCommandDependencies
extends OfficialRegistryActiveCommandDependencies {
  readonly trust?: OfficialRegistryPackageInstallerOptions["trust"];
  readonly executionPolicy?: OfficialRegistryPackageInstallerOptions["executionPolicy"];
  readonly environmentProvider?: OfficialRegistryPackageInstallerOptions["environmentProvider"];
  readonly addressResolver?: OfficialRegistryArtifactAddressResolver;
  readonly transport?: OfficialRegistryArtifactTransport;
  readonly temporaryRoot?: string;
}

function installFailure(message: string): AuroraError {
  return new AuroraError(
    `Official registry installation refused: ${message}`,
    {
      code: ErrorCodes.PACKAGE_INTEGRITY_FAILED,
      suggestion: "Use a trusted registry digest and a compatible authenticated lock set. Existing lock selections are never replaced automatically.",
    }
  );
}

function selectorFor(options: InstallActiveOfficialRegistryPackageOptions): OfficialRegistryVersionSelector {
  if (typeof options.registryDigest !== "string" || !/^[0-9a-f]{64}$/u.test(options.registryDigest)) {
    throw installFailure("--registry-digest must be a trusted lowercase SHA-256 digest.");
  }
  if (options.version !== undefined && options.range !== undefined) {
    throw installFailure("provide either --version or --range, not both.");
  }
  if (options.offline !== undefined && typeof options.offline !== "boolean") {
    throw installFailure("--offline must be a boolean.");
  }
  if (options.offline && (options.version !== undefined || options.range !== undefined)) {
    throw installFailure("offline installation uses aurora.lock and does not accept version selectors.");
  }
  if (options.version !== undefined) {
    if (!isManifestSemVer(options.version)) {
      throw installFailure("the exact version is not a canonical semantic version.");
    }
    return { kind: "exact", version: options.version };
  }
  if (options.range !== undefined) {
    if (!isManifestVersionRange(options.range)) {
      throw installFailure("the version range is invalid.");
    }
    return { kind: "range", range: options.range };
  }
  return { kind: "latest" };
}

export async function installActiveOfficialRegistryPackage(
  packageId: string,
  options: InstallActiveOfficialRegistryPackageOptions,
  dependencies: OfficialRegistryInstallCommandDependencies = {}
): Promise<void> {
  assertCanonicalPackageIdentifier(packageId);
  const selector = selectorFor(options);
  const project = new ProjectPathBoundary(dependencies.workspaceRoot ?? process.cwd());
  const reader = new OfficialRegistryActiveReader({
    workspaceRoot: project.projectRoot,
    registryDirectory: dependencies.registryDirectory,
    expectedSnapshotDigest: options.registryDigest,
    registryVerifierOptions: dependencies.registryVerifierOptions,
  });
  const active = await reader.read();
  const registryOptions = {
    previous: active.previous,
    verifierOptions: dependencies.registryVerifierOptions,
  };
  const snapshot = active.current.snapshot;
  const resolver = new OfficialRegistryResolver(snapshot, registryOptions);
  const lockManager = new LockManager(project.projectRoot);
  const initialLock = await lockManager.read();
  // Official installs never enter the legacy unsigned compatibility path.
  const trustOptions = { ...dependencies.trust, requireSignatures: true };
  const executionPolicy = options.offline
    ? { ...dependencies.executionPolicy, packageNetworkGrants: [] }
    : dependencies.executionPolicy;
  const trust = new PackageTrustPolicy(trustOptions);
  const capabilities = new PackageCapabilityPolicy(executionPolicy);
  const compatibility = new CompatibilityChecker();

  const select = (id: string, requested: OfficialRegistryVersionSelector) => {
    const locked = initialLock.packages[id];
    if (typeof locked === "string" || (options.offline && locked === undefined)) {
      throw installFailure(`'${id}' needs a full official-registry lock identity.`);
    }
    if (locked !== undefined) {
      if (
        (requested.kind === "exact" && locked.version !== requested.version) ||
        (requested.kind === "range" && !satisfiesManifestVersionRange(locked.version, requested.range))
      ) {
        throw installFailure(`the existing lock for '${id}' does not satisfy the requested version.`);
      }
      const resolved = resolver.resolve(id, { kind: "exact", version: locked.version });
      const entry = resolved.entry;
      if (
        locked.registry.digest !== resolved.registryDigest ||
        locked.registry.sequence !== resolved.registrySequence ||
        locked.manifest.digest !== entry.manifestDigest ||
        locked.archive.digest !== entry.archive.digest ||
        locked.archive.size !== entry.archive.size ||
        locked.archive.url !== entry.archive.url
      ) {
        throw installFailure(`the lock for '${id}' does not match the pinned registry.`);
      }
      return resolved;
    }
    return resolver.resolve(id, requested);
  };

  // Reject an invalid root before creating cache or temporary directories.
  select(packageId, selector);
  const cachePath = project.resolve(".aurora/official-artifacts");
  if (options.offline) {
    const information = await fs.lstat(cachePath).catch(error => {
      if (error?.code === "ENOENT") {
        throw installFailure("the offline artifact cache is missing.");
      }
      throw error;
    });
    if (!information.isDirectory() || information.isSymbolicLink()) {
      throw installFailure("the offline artifact cache is not a real directory.");
    }
  } else {
    await fs.mkdir(cachePath, { recursive: true, mode: 0o700 });
  }
  const cache = new OfficialRegistryArtifactCache(
    snapshot, project.resolve(".aurora/official-artifacts"), { registryOptions }
  );
  const temporary = new ProjectPathBoundary(dependencies.temporaryRoot ?? tmpdir());
  const workPath = await fs.mkdtemp(join(temporary.projectRoot, "aurora-official-install-"));
  const workIdentity = await fs.lstat(workPath);
  let failed = false;
  let failure: unknown;
  try {
    const acquirer = new OfficialRegistryArtifactAcquirer(snapshot, {
      registryOptions,
      quarantineRoot: workPath,
      addressResolver: dependencies.addressResolver,
      transport: dependencies.transport,
    });
    const extracted = new Map<string, ExtractedOfficialRegistryArtifact>();
    const visiting = new Set<string>();
    const order: ExtractedOfficialRegistryArtifact[] = [];
    let archiveBytes = 0;
    let extractedBytes = 0;
    let extractedFiles = 0;

    const visit = async (id: string, requested: OfficialRegistryVersionSelector): Promise<void> => {
      const resolved = select(id, requested);
      if (visiting.has(id)) {
        throw installFailure(`the dependency graph contains a cycle through '${id}'.`);
      }
      const prior = extracted.get(id);
      if (prior !== undefined) {
        const version = prior.manifest.version;
        if (
          (requested.kind === "exact" && version !== requested.version) ||
          (requested.kind === "range" && !satisfiesManifestVersionRange(version, requested.range))
        ) {
          throw installFailure(`dependency constraints conflict for '${id}'; automatic backtracking is not supported.`);
        }
        return;
      }
      archiveBytes += resolved.entry.archive.size;
      if (
        extracted.size >= OFFICIAL_INSTALL_MAX_PACKAGES ||
        archiveBytes > OFFICIAL_INSTALL_MAX_ARCHIVE_BYTES ||
        extractedBytes >= OFFICIAL_REGISTRY_EXTRACTION_MAX_BYTES ||
        extractedFiles >= OFFICIAL_REGISTRY_EXTRACTION_MAX_ENTRIES
      ) {
        throw installFailure("the dependency set exceeds the bounded installation budget.");
      }
      visiting.add(id);
      const exact = { kind: "exact", version: resolved.entry.version } as const;
      let cached = await cache.get(id, exact);
      if (cached === undefined) {
        if (options.offline) {
          throw installFailure(`the verified offline cache is missing '${id}@${exact.version}'.`);
        }
        const acquired = await acquirer.acquire(id, exact);
        cached = await cache.store(acquired);
      }
      const candidate = await new OfficialRegistryArtifactExtractor(snapshot, workPath, {
        registryOptions,
        maxExtractedBytes: OFFICIAL_REGISTRY_EXTRACTION_MAX_BYTES - extractedBytes,
        maxEntries: OFFICIAL_REGISTRY_EXTRACTION_MAX_ENTRIES - extractedFiles,
      }).extract(cached);
      extracted.set(id, candidate);
      extractedBytes += candidate.extractedBytes;
      extractedFiles += candidate.extractedFiles;
      trust.verify(candidate.manifest);
      capabilities.assertManifest(candidate.manifest);
      compatibility.check(candidate.manifest);
      const required = [...candidate.manifest.dependencies].sort(
        (left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      );
      for (const dependency of required) {
        if (dependency.optional && initialLock.packages[dependency.id] === undefined) {
          continue;
        }
        await visit(dependency.id, { kind: "range", range: dependency.version });
      }
      visiting.delete(id);
      order.push(candidate);
    };

    await visit(packageId, selector);
    // Coordinate plan publication with other lifecycle mutations and recover
    // interrupted work before comparing the original lock observation.
    let locked: readonly LockedOfficialRegistryPackage[];
    const lifecycleLock = await ProjectLifecycleLock.acquire(project.projectRoot);
    try {
      await new LifecycleRecoveryManager(project.projectRoot).recoverIncomplete(lifecycleLock);
      await reader.read();
      const installed = await new CacheManager(project.projectRoot).readExisting();
      for (const candidate of order) {
        const id = candidate.manifest.id;
        if (installed[id] !== undefined) {
          if (initialLock.packages[id] === undefined) {
            throw installFailure(`'${id}' is already installed without an authenticated lock; implicit adoption is not supported.`);
          }
          await new InstalledStateVerifier().verify(id, project.projectRoot);
        }
      }
      const locker = new OfficialRegistryPackageLocker(snapshot, project.projectRoot, { registryOptions });
      locked = options.offline
        ? await locker.bindExistingSet(order)
        : await locker.lockMissingSet(order, initialLock);
    } finally {
      await lifecycleLock.release();
    }
    // The installer acquires its own lifecycle lock and revalidates every
    // receipt against persisted state; it does not trust this unlocked gap.
    await reader.read();
    const requested = locked.find(candidate => candidate.entry.packageId === packageId);
    if (requested === undefined) {
      throw installFailure("the requested package disappeared from the verified set.");
    }
    await new OfficialRegistryPackageInstaller({
      projectRoot: project.projectRoot,
      trust: trustOptions,
      executionPolicy,
      environmentProvider: dependencies.environmentProvider,
    }).installSet(requested, locked.filter(candidate => candidate !== requested));
  } catch (error) {
    failed = true;
    failure = error;
  }

  try {
    const safePath = temporary.validateAbsolutePath(workPath);
    const current = await fs.lstat(safePath);
    if (
      !current.isDirectory() || current.isSymbolicLink() ||
      current.dev !== workIdentity.dev || current.ino !== workIdentity.ino
    ) {
      throw new Error("The owned temporary directory was replaced.");
    }
    await fs.rm(safePath, { recursive: true });
  } catch (error) {
    if (!failed) {
      throw new AuroraError("Official installation completed, but private staging cleanup failed.", {
        code: ErrorCodes.PACKAGE_EXTRACTION_FAILED,
        suggestion: "Inspect the temporary staging directory before removing it.",
        cause: error,
      });
    }
  }
  if (failed) {
    throw failure;
  }
  console.log(`Installed '${packageId}' from pinned official registry ${active.current.digest}.`);
}
