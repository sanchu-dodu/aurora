import fs from "node:fs/promises";

import {
  InstallerContext,
} from "../installer/installerContext.js";

import type {
  PackageState,
  PackageStateReceipt,
} from "../state/packageStateSchema.js";

import {
  parsePackageState,
} from "../state/packageStateSchema.js";

import {
  WriteLock,
} from "../synchronization/writeLock.js";

import {
  InstalledStateVerifier,
} from "../verify/installedStateVerifier.js";

import {
  compareManifestSemVer,
  parseManifestSemVer,
} from "../version/manifestVersion.js";

import {
  mergePackageOwnershipReceipts,
} from "./packageOwnershipTransition.js";

import {
  UpdateExecutor,
  type UpdateExecutionResult,
} from "./updateExecutor.js";


interface InstalledStateVerifierLike {
  verify(
    packageId: string,
    projectPath: string
  ): Promise<void>;

  verifyReceipt(
    packageId: string,
    projectPath: string,
    receipt:
      PackageStateReceipt
  ): Promise<void>;
}


interface WriteLockLike {
  acquire(): Promise<void>;

  release(): void;
}


interface UpdateExecutorLike {
  execute(
    packageId: string,
    targetVersion: string,
    context: InstallerContext
  ): Promise<
    UpdateExecutionResult
  >;
}


interface CacheEntry {
  version: string;

  installedAt: string;

  checksum?: string;

  verified?: boolean;

  [key: string]:
    unknown;
}


interface LockDocument {
  packages:
    Record<
      string,
      string
    >;

  [key: string]:
    unknown;
}


interface UpdateMetadata {
  state:
    PackageState;

  cache:
    Record<
      string,
      CacheEntry
    >;

  lock:
    LockDocument;

  receipt:
    PackageStateReceipt;
}


export class PackageUpdateCoordinator {
  constructor(
    private readonly executor:
      UpdateExecutorLike =
        new UpdateExecutor(),

    private readonly verifier:
      InstalledStateVerifierLike =
        new InstalledStateVerifier(),

    private readonly writeLock:
      WriteLockLike =
        new WriteLock()
  ) {}


  async execute(
    packageId: string,
    projectPath: string,
    currentVersion: string,
    targetVersion: string
  ): Promise<void> {
    const comparison =
      compareManifestSemVer(
        parseManifestSemVer(
          targetVersion
        ),
        parseManifestSemVer(
          currentVersion
        )
      );

    if (
      comparison <= 0
    ) {
      throw new Error(
        `Package update requires a strictly newer target version: '${currentVersion}' -> '${targetVersion}'.`
      );
    }

    /*
     * Perform the ordinary installed-state gate
     * before taking the lifecycle lock. Normal
     * InstalledStateVerifier.verify() reads
     * PackageStateStore and therefore acquires the
     * same non-reentrant WriteLock internally.
     */
    await this.verifier.verify(
      packageId,
      projectPath
    );

    await this.writeLock
      .acquire();

    let context:
      InstallerContext |
      undefined;

    try {
      context =
        new InstallerContext(
          projectPath
        );

      const statePath =
        context.resolveProjectPath(
          ".aurora/package-state.json"
        );

      const cachePath =
        context.resolveProjectPath(
          ".aurora/cache.json"
        );

      const lockPath =
        context.resolveProjectPath(
          "aurora.lock"
        );

      /*
       * Snapshot all lifecycle metadata into the
       * same transaction used by the mutation-capable
       * InstallerContext before PackageWorker runs.
       *
       * recordModifiedFile is read-only until a
       * later mutation occurs.
       */
      await context.transaction
        .recordModifiedFile(
          statePath
        );

      await context.transaction
        .recordModifiedFile(
          cachePath
        );

      await context.transaction
        .recordModifiedFile(
          lockPath
        );

      const metadata =
        await this.readMetadata(
          statePath,
          cachePath,
          lockPath,
          packageId
        );

      this.assertCurrentVersion(
        packageId,
        currentVersion,
        metadata
      );

      /*
       * Reverify the exact schema-validated receipt
       * read while holding WriteLock immediately
       * before handing a mutation-capable context
       * to PackageWorker.
       *
       * This path deliberately does not re-enter
       * PackageStateStore's WriteLock.
       */
      await this.verifier
        .verifyReceipt(
          packageId,
          projectPath,
          metadata.receipt
        );

      const execution =
        await this.executor.execute(
          packageId,
          targetVersion,
          context
        );

      if (
        execution.version !==
          targetVersion ||
        execution.receipt.version !==
          targetVersion
      ) {
        throw new Error(
          `Package '${packageId}' executed version '${execution.version}' while update target '${targetVersion}' was required.`
        );
      }

      if (
        execution.receipt.id !==
          packageId
      ) {
        throw new Error(
          `Package update execution returned ownership for '${execution.receipt.id}' instead of '${packageId}'.`
        );
      }

      const mergedReceipt =
        mergePackageOwnershipReceipts(
          metadata.receipt,
          execution.receipt
        );

      /*
       * Every remaining installed package is checked
       * against the post-execution project before
       * target package metadata is replaced.
       */
      const remainingPackages =
        Object.keys(
          metadata.state.packages
        )
          .filter(
            id =>
              id !==
              packageId
          )
          .sort();

      for (
        const remainingPackage
        of remainingPackages
      ) {
        await this.verifier
          .verifyReceipt(
            remainingPackage,
            projectPath,
            metadata.state.packages[
              remainingPackage
            ]
          );
      }

      metadata.state.packages[
        packageId
      ] =
        mergedReceipt;

      metadata.cache[
        packageId
      ] = {
        ...metadata.cache[
          packageId
        ],

        version:
          targetVersion,

        installedAt:
          mergedReceipt
            .installedAt,

        checksum:
          execution.checksum,

        verified:
          true,
      };

      metadata.lock.packages[
        packageId
      ] =
        targetVersion;

      await this.writeMetadata(
        context,
        metadata
      );

      /*
       * Final verification occurs while rollback
       * bytes are still retained and while the
       * lifecycle WriteLock remains held.
       */
      await this.verifier
        .verifyReceipt(
          packageId,
          projectPath,
          mergedReceipt
        );

      /*
       * Verification proved the complete target
       * state. Discard rollback snapshots only now,
       * immediately before releasing WriteLock.
       */
      context.transaction
        .commit();
    }
    catch (error) {
      if (context) {
        await context.transaction
          .rollback();
      }

      throw error;
    }
    finally {
      this.writeLock.release();
    }
  }


  private async readMetadata(
    statePath: string,
    cachePath: string,
    lockPath: string,
    packageId: string
  ): Promise<
    UpdateMetadata
  > {
    const stateContent =
      await fs.readFile(
        statePath,
        "utf8"
      );

    const cacheContent =
      await fs.readFile(
        cachePath,
        "utf8"
      );

    const lockContent =
      await fs.readFile(
        lockPath,
        "utf8"
      );

    let stateDecoded:
      unknown;

    let cacheDecoded:
      unknown;

    let lockDecoded:
      unknown;

    try {
      stateDecoded =
        JSON.parse(
          stateContent
        );

      cacheDecoded =
        JSON.parse(
          cacheContent
        );

      lockDecoded =
        JSON.parse(
          lockContent
        );
    }
    catch {
      throw new TypeError(
        "Installed lifecycle metadata contains invalid JSON."
      );
    }

    const state =
      parsePackageState(
        stateDecoded
      );

    const cache =
      assertCache(
        cacheDecoded
      );

    const lock =
      assertLock(
        lockDecoded
      );

    const receipt =
      state.packages[
        packageId
      ];

    if (!receipt) {
      throw new Error(
        `Package '${packageId}' has no ownership receipt during update.`
      );
    }

    return {
      state,
      cache,
      lock,
      receipt,
    };
  }


  private assertCurrentVersion(
    packageId: string,
    currentVersion: string,
    metadata: UpdateMetadata
  ): void {
    if (
      metadata.receipt.version !==
        currentVersion
    ) {
      throw new Error(
        `Package '${packageId}' ownership version changed from planned '${currentVersion}' to '${metadata.receipt.version}'.`
      );
    }

    const cacheEntry =
      metadata.cache[
        packageId
      ];

    if (!cacheEntry) {
      throw new Error(
        `Package '${packageId}' disappeared from cache during update.`
      );
    }

    if (
      cacheEntry.version !==
        currentVersion
    ) {
      throw new Error(
        `Package '${packageId}' cache version changed during update.`
      );
    }

    if (
      metadata.lock.packages[
        packageId
      ] !==
        currentVersion
    ) {
      throw new Error(
        `Package '${packageId}' lock version changed during update.`
      );
    }
  }


  private async writeMetadata(
    context: InstallerContext,
    metadata: UpdateMetadata
  ): Promise<void> {
    const state =
      normalizeState(
        parsePackageState(
          metadata.state
        )
      );

    /*
     * Re-resolve each protected metadata path
     * immediately before its mutation.
     */
    await fs.writeFile(
      context.resolveProjectPath(
        ".aurora/package-state.json"
      ),
      `${JSON.stringify(
        state,
        null,
        2
      )}\n`,
      {
        encoding:
          "utf8",

        mode:
          0o600,
      }
    );

    await fs.writeFile(
      context.resolveProjectPath(
        ".aurora/cache.json"
      ),
      JSON.stringify(
        metadata.cache,
        null,
        2
      ),
      "utf8"
    );

    await fs.writeFile(
      context.resolveProjectPath(
        "aurora.lock"
      ),
      JSON.stringify(
        metadata.lock,
        null,
        2
      ),
      "utf8"
    );
  }
}


function assertCache(
  input: unknown
): Record<
  string,
  CacheEntry
> {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    throw new TypeError(
      "Aurora installed-package cache must be an object."
    );
  }

  const inputCache =
    input as
      Record<
        string,
        unknown
      >;

  const cache:
    Record<
      string,
      CacheEntry
    > = {};

  for (
    const [
      packageId,
      entry,
    ]
    of Object.entries(
      inputCache
    )
  ) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry)
    ) {
      throw new TypeError(
        `Cache entry '${packageId}' must be an object.`
      );
    }

    const candidate =
      entry as
        Record<
          string,
          unknown
        >;

    if (
      typeof candidate.version !==
        "string" ||
      typeof candidate.installedAt !==
        "string"
    ) {
      throw new TypeError(
        `Cache entry '${packageId}' is missing required lifecycle metadata.`
      );
    }

    cache[
      packageId
    ] =
      candidate as
        unknown as
        CacheEntry;
  }

  return cache;
}


function assertLock(
  input: unknown
): LockDocument {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    throw new TypeError(
      "Aurora lock metadata must be an object."
    );
  }

  const inputLock =
    input as
      Record<
        string,
        unknown
      >;

  if (
    typeof inputLock.packages !==
      "object" ||
    inputLock.packages ===
      null ||
    Array.isArray(
      inputLock.packages
    )
  ) {
    throw new TypeError(
      "Aurora lock metadata requires a packages object."
    );
  }

  const packages:
    Record<
      string,
      string
    > = {};

  for (
    const [
      packageId,
      version,
    ]
    of Object.entries(
      inputLock.packages
    )
  ) {
    if (
      typeof version !==
        "string"
    ) {
      throw new TypeError(
        `Lock entry '${packageId}' must contain a version string.`
      );
    }

    packages[
      packageId
    ] =
      version;
  }

  return {
    ...inputLock,

    packages,
  };
}


function normalizeState(
  state: PackageState
): PackageState {
  const packages:
    Record<
      string,
      PackageStateReceipt
    > = {};

  for (
    const packageId
    of Object.keys(
      state.packages
    ).sort()
  ) {
    const receipt =
      state.packages[
        packageId
      ];

    packages[
      packageId
    ] = {
      ...receipt,

      files:
        [...receipt.files]
          .sort(
            (left, right) =>
              compareText(
                left.path,
                right.path
              )
          ),

      dependencies:
        [...receipt.dependencies]
          .sort(
            (left, right) =>
              compareText(
                left.name,
                right.name
              )
          ),

      environment:
        [...receipt.environment]
          .sort(
            (left, right) =>
              compareText(
                left.name,
                right.name
              )
          ),
    };
  }

  return {
    schemaVersion:
      state.schemaVersion,

    packages,
  };
}


function compareText(
  left: string,
  right: string
): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
