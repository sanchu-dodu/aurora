import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  constants as fsConstants,
} from "node:fs";

import fs from "node:fs/promises";

import {
  dirname,
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
  syncDirectory,
} from "../lifecycle/durableFileWriter.js";

import {
  OFFICIAL_REGISTRY_ARTIFACT_MAX_BYTES,
  assertVerifiedOfficialRegistryArtifact,
} from "./officialRegistryArtifactAcquirer.js";

import type {
  VerifiedOfficialRegistryArtifact,
} from "./officialRegistryArtifactAcquirer.js";

import type {
  OfficialRegistryCatalogOptions,
} from "./officialRegistryCatalog.js";

import {
  OfficialRegistryResolver,
} from "./officialRegistryResolver.js";

import type {
  OfficialRegistryVersionSelector,
  ResolvedOfficialRegistryPackage,
} from "./officialRegistryResolver.js";

import type {
  OfficialRegistryPackageEntry,
} from "./officialRegistrySchema.js";

const CACHE_ALGORITHM_DIRECTORY =
  "sha256";

const COPY_BUFFER_BYTES =
  64 * 1024;

const cachedArtifacts =
  new WeakSet<object>();

const LATEST_SELECTOR =
  Object.freeze({
    kind:
      "latest",
  } as const);

export interface OfficialRegistryArtifactCacheOptions {
  readonly registryOptions?:
    OfficialRegistryCatalogOptions;
  readonly maxArchiveBytes?: number;
}

export interface CachedOfficialRegistryArtifact {
  readonly source:
    "verified-cache";
  readonly resolved:
    ResolvedOfficialRegistryPackage;
  readonly filePath: string;
  readonly verifiedBytes: number;
}

function cacheFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}' artifact cache failed: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_ARTIFACT_CACHE_FAILED,
      suggestion:
        "Use a private local cache directory and retry with an authenticated official registry snapshot.",
      cause,
    }
  );
}

function cacheIntegrityFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}' cached archive failed verification: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED,
      suggestion:
        "Remove the corrupted cache entry and reacquire it from the signed official registry URL.",
      cause,
    }
  );
}

function isErrno(
  error: unknown,
  code: string
): boolean {
  return (
    typeof error ===
      "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function archiveRelativePath(
  digest: string
): string {
  return `${CACHE_ALGORITHM_DIRECTORY}/${digest.slice(0, 2)}/${digest}.archive`;
}

function archiveDirectoryRelativePath(
  digest: string
): string {
  return `${CACHE_ALGORITHM_DIRECTORY}/${digest.slice(0, 2)}`;
}

function assertSameEntryIdentity(
  expected:
    OfficialRegistryPackageEntry,
  received:
    OfficialRegistryPackageEntry
): void {
  if (
    expected.packageId !==
      received.packageId ||
    expected.version !==
      received.version ||
    expected.manifestDigest !==
      received.manifestDigest ||
    expected.archive.algorithm !==
      received.archive.algorithm ||
    expected.archive.digest !==
      received.archive.digest ||
    expected.archive.size !==
      received.archive.size ||
    expected.archive.url !==
      received.archive.url ||
    expected.provenance.type !==
      received.provenance.type ||
    expected.provenance.url !==
      received.provenance.url ||
    expected.provenance.reference !==
      received.provenance.reference ||
    expected.lifecycle.status !==
      received.lifecycle.status ||
    expected.lifecycle.reason !==
      received.lifecycle.reason
  ) {
    throw cacheIntegrityFailure(
      expected.packageId,
      "the acquired receipt does not match the cache's authenticated registry identity."
    );
  }
}

async function writeAll(
  handle: fs.FileHandle,
  buffer: Buffer,
  length: number
): Promise<void> {
  let offset = 0;

  while (offset < length) {
    const result =
      await handle.write(
        buffer,
        offset,
        length - offset,
        null
      );

    if (result.bytesWritten <= 0) {
      throw new Error(
        "Artifact cache write made no progress."
      );
    }

    offset +=
      result.bytesWritten;
  }
}

async function hashFileHandle(
  handle: fs.FileHandle,
  packageId: string,
  expectedSize: number,
  expectedDigest: string,
  destination?: fs.FileHandle
): Promise<number> {
  const hash =
    createHash(
      "sha256"
    );

  const buffer =
    Buffer.allocUnsafe(
      COPY_BUFFER_BYTES
    );

  let total = 0;

  while (true) {
    const result =
      await handle.read(
        buffer,
        0,
        buffer.byteLength,
        null
      );

    if (result.bytesRead === 0) {
      break;
    }

    if (
      total +
        result.bytesRead >
      expectedSize
    ) {
      throw cacheIntegrityFailure(
        packageId,
        "the file exceeds the signed archive size."
      );
    }

    hash.update(
      buffer.subarray(
        0,
        result.bytesRead
      )
    );

    if (destination !== undefined) {
      await writeAll(
        destination,
        buffer,
        result.bytesRead
      );
    }

    total +=
      result.bytesRead;
  }

  if (total !== expectedSize) {
    throw cacheIntegrityFailure(
      packageId,
      "the file byte count does not match the signed archive size."
    );
  }

  const actualDigest =
    hash.digest(
      "hex"
    );

  if (actualDigest !== expectedDigest) {
    throw cacheIntegrityFailure(
      packageId,
      "the file SHA-256 digest does not match the signed archive digest."
    );
  }

  return total;
}

async function openRegularFile(
  file: string,
  packageId: string,
  label: string
): Promise<fs.FileHandle> {
  const handle =
    await fs.open(
      file,
      process.platform ===
        "win32"
        ? "r"
        : fsConstants.O_RDONLY |
          fsConstants.O_NOFOLLOW
    );

  try {
    const [
      openedInformation,
      information,
    ] =
      await Promise.all(
        [
          handle.stat(),
          fs.lstat(
            file
          ),
        ]
      );

    if (
      information.isSymbolicLink() ||
      !information.isFile() ||
      !openedInformation.isFile()
    ) {
      throw cacheIntegrityFailure(
        packageId,
        `${label} is not a regular file.`
      );
    }

    if (
      openedInformation.dev !==
        information.dev ||
      openedInformation.ino !==
        information.ino
    ) {
      throw cacheIntegrityFailure(
        packageId,
        `${label} did not open as the same regular file that was inspected.`
      );
    }

    return handle;
  }
  catch (error) {
    await handle.close();
    throw error;
  }
}

function createCachedReceipt(
  resolved:
    ResolvedOfficialRegistryPackage,
  filePath: string
): CachedOfficialRegistryArtifact {
  const receipt:
    CachedOfficialRegistryArtifact =
      Object.freeze({
        source:
          "verified-cache",
        resolved,
        filePath,
        verifiedBytes:
          resolved.entry.archive.size,
      });

  cachedArtifacts.add(
    receipt
  );

  return receipt;
}

export function assertCachedOfficialRegistryArtifact(
  value: unknown
): asserts value is
  CachedOfficialRegistryArtifact {
  if (
    typeof value !==
      "object" ||
    value === null ||
    !cachedArtifacts.has(
      value
    )
  ) {
    throw new TypeError(
      "Expected an authentic cached official registry artifact receipt."
    );
  }
}

export class OfficialRegistryArtifactCache {
  private readonly registryResolver:
    OfficialRegistryResolver;

  private readonly boundary:
    ProjectPathBoundary;

  private readonly maxArchiveBytes:
    number;

  constructor(
    value: unknown,
    cacheRoot: string,
    options:
      OfficialRegistryArtifactCacheOptions = {}
  ) {
    this.registryResolver =
      new OfficialRegistryResolver(
        value,
        options.registryOptions
      );

    this.boundary =
      new ProjectPathBoundary(
        cacheRoot
      );

    this.maxArchiveBytes =
      options.maxArchiveBytes ??
      OFFICIAL_REGISTRY_ARTIFACT_MAX_BYTES;

    if (
      !Number.isSafeInteger(
        this.maxArchiveBytes
      ) ||
      this.maxArchiveBytes <= 0 ||
      this.maxArchiveBytes >
        OFFICIAL_REGISTRY_ARTIFACT_MAX_BYTES
    ) {
      throw new TypeError(
        "Official registry artifact cache maxArchiveBytes must be a positive safe integer no greater than Aurora's absolute archive limit."
      );
    }

    Object.freeze(
      this
    );
  }

  async get(
    packageId: string,
    selector:
      OfficialRegistryVersionSelector =
        LATEST_SELECTOR
  ): Promise<
    CachedOfficialRegistryArtifact |
    undefined
  > {
    const resolved =
      this.registryResolver.resolve(
        packageId,
        selector
      );

    this.assertArchiveWithinLimit(
      resolved
    );

    await this.assertCacheRootSafe(
      packageId
    );

    const file =
      this.resolveCachePath(
        archiveRelativePath(
          resolved.entry.archive.digest
        ),
        packageId
      );

    try {
      await this.verifyCachedFile(
        resolved,
        file
      );
    }
    catch (error) {
      if (isErrno(
        error,
        "ENOENT"
      )) {
        return undefined;
      }

      if (
        error instanceof AuroraError &&
        error.code ===
          ErrorCodes
            .PACKAGE_INTEGRITY_FAILED
      ) {
        throw error;
      }

      throw cacheIntegrityFailure(
        packageId,
        "the content-addressed cache path is unsafe or unreadable.",
        error
      );
    }

    return createCachedReceipt(
      resolved,
      file
    );
  }

  async store(
    artifact:
      VerifiedOfficialRegistryArtifact
  ): Promise<
    CachedOfficialRegistryArtifact
  > {
    assertVerifiedOfficialRegistryArtifact(
      artifact
    );

    const packageId =
      artifact.resolved.entry.packageId;

    const resolved =
      this.registryResolver.resolve(
        packageId,
        {
          kind: "exact",
          version:
            artifact.resolved.entry.version,
        }
      );

    assertSameEntryIdentity(
      resolved.entry,
      artifact.resolved.entry
    );

    this.assertArchiveWithinLimit(
      resolved
    );

    await this.assertCacheRootSafe(
      packageId
    );

    if (
      artifact.receivedBytes !==
        resolved.entry.archive.size
    ) {
      throw cacheIntegrityFailure(
        packageId,
        "the acquisition receipt byte count does not match the authenticated registry."
      );
    }

    const relativeDirectory =
      archiveDirectoryRelativePath(
        resolved.entry.archive.digest
      );

    await this.ensureCacheDirectory(
      CACHE_ALGORITHM_DIRECTORY,
      packageId
    );

    await this.ensureCacheDirectory(
      relativeDirectory,
      packageId
    );

    const finalFile =
      this.resolveCachePath(
        archiveRelativePath(
          resolved.entry.archive.digest
        ),
        packageId
      );

    const temporaryFile =
      this.resolveCachePath(
        `${relativeDirectory}/.${resolved.entry.archive.digest}.${process.pid}.${randomUUID()}.tmp`,
        packageId
      );

    let source:
      fs.FileHandle | undefined;

    let temporary:
      fs.FileHandle | undefined;

    let cleanupFailure:
      unknown;

    try {
      source =
        await openRegularFile(
          artifact.filePath,
          packageId,
          "the quarantined source archive"
        );

      temporary =
        await fs.open(
          temporaryFile,
          "wx",
          0o600
        );

      await hashFileHandle(
        source,
        packageId,
        resolved.entry.archive.size,
        resolved.entry.archive.digest,
        temporary
      );

      await temporary.sync();
      await temporary.close();
      temporary = undefined;

      await source.close();
      source = undefined;

      try {
        await fs.link(
          temporaryFile,
          finalFile
        );

        await syncDirectory(
          dirname(
            finalFile
          )
        );
      }
      catch (error) {
        if (!isErrno(
          error,
          "EEXIST"
        )) {
          throw error;
        }

        await this.verifyCachedFile(
          resolved,
          finalFile
        );
      }

      await fs.rm(
        temporaryFile,
        {
          force: true,
        }
      );

      await syncDirectory(
        dirname(
          finalFile
        )
      );

      await this.verifyCachedFile(
        resolved,
        finalFile
      );

      return createCachedReceipt(
        resolved,
        finalFile
      );
    }
    catch (error) {
      try {
        await temporary?.close();
      }
      catch (closeError) {
        cleanupFailure =
          closeError;
      }

      try {
        await source?.close();
      }
      catch (closeError) {
        cleanupFailure ??=
          closeError;
      }

      try {
        await fs.rm(
          temporaryFile,
          {
            force: true,
          }
        );
      }
      catch (removeError) {
        cleanupFailure ??=
          removeError;
      }

      if (
        cleanupFailure !==
          undefined
      ) {
        throw cacheFailure(
          packageId,
          "temporary cache data could not be removed safely.",
          new AggregateError([
            error,
            cleanupFailure,
          ])
        );
      }

      if (error instanceof AuroraError) {
        throw error;
      }

      throw cacheFailure(
        packageId,
        "the verified archive could not be published atomically.",
        error
      );
    }
  }

  private assertArchiveWithinLimit(
    resolved:
      ResolvedOfficialRegistryPackage
  ): void {
    if (
      resolved.entry.archive.size >
        this.maxArchiveBytes
    ) {
      throw cacheFailure(
        resolved.entry.packageId,
        "the signed archive exceeds the configured cache byte limit."
      );
    }
  }

  private async ensureCacheDirectory(
    relativeDirectory: string,
    packageId: string
  ): Promise<void> {
    const directory =
      this.resolveCachePath(
        relativeDirectory,
        packageId
      );

    try {
      await fs.mkdir(
        directory,
        {
          recursive: false,
          mode: 0o700,
        }
      );

      await syncDirectory(
        dirname(
          directory
        )
      );
    }
    catch (error) {
      if (!isErrno(
        error,
        "EEXIST"
      )) {
        throw cacheFailure(
          packageId,
          "the content-addressed cache directory could not be created.",
          error
        );
      }
    }

    try {
      const validated =
        this.resolveCachePath(
          relativeDirectory,
          packageId
        );

      const information =
        await fs.lstat(
          validated
        );

      if (
        information.isSymbolicLink() ||
        !information.isDirectory()
      ) {
        throw new Error(
          "Artifact cache path is not a regular directory."
        );
      }
    }
    catch (error) {
      throw cacheIntegrityFailure(
        packageId,
        "the content-addressed cache directory is unsafe.",
        error
      );
    }
  }

  private async assertCacheRootSafe(
    packageId: string
  ): Promise<void> {
    try {
      const information =
        await fs.lstat(
          this.boundary
            .projectRoot
        );

      if (
        information.isSymbolicLink() ||
        !information.isDirectory()
      ) {
        throw new Error(
          "Artifact cache root is not a regular directory."
        );
      }
    }
    catch (error) {
      throw cacheIntegrityFailure(
        packageId,
        "the cache root is unsafe or unavailable.",
        error
      );
    }
  }

  private resolveCachePath(
    relativePath: string,
    packageId: string
  ): string {
    try {
      return this.boundary.resolve(
        relativePath
      );
    }
    catch (error) {
      throw cacheIntegrityFailure(
        packageId,
        "the content-addressed cache path is unsafe.",
        error
      );
    }
  }

  private async verifyCachedFile(
    resolved:
      ResolvedOfficialRegistryPackage,
    file: string
  ): Promise<void> {
    let handle:
      fs.FileHandle | undefined;

    try {
      handle =
        await openRegularFile(
          file,
          resolved.entry.packageId,
          "the cached archive"
        );

      await hashFileHandle(
        handle,
        resolved.entry.packageId,
        resolved.entry.archive.size,
        resolved.entry.archive.digest
      );

      const pathInformation =
        await fs.lstat(
          file
        );

      const openedInformation =
        await handle.stat();

      if (
        pathInformation.isSymbolicLink() ||
        !pathInformation.isFile() ||
        pathInformation.dev !==
          openedInformation.dev ||
        pathInformation.ino !==
          openedInformation.ino
      ) {
        throw cacheIntegrityFailure(
          resolved.entry.packageId,
          "the cache path changed while its archive was being verified."
        );
      }
    }
    finally {
      await handle?.close();
    }
  }
}
