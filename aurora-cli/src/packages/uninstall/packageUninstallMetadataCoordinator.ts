import fs from "node:fs/promises";

import {
  FileTransaction,
} from "../../core/fileTransaction.js";

import {
  DurableFileTransaction,
} from "../lifecycle/durableFileTransaction.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import type {
  CachedPackage,
} from "../cache/cacheManager.js";

import type {
  LockFile,
} from "../lock/lockManager.js";

import {
  PACKAGE_STATE_MAX_BYTES,
  parsePackageState,
  type PackageState,
  type PackageStateReceipt,
} from "../state/packageStateSchema.js";

import {
  PACKAGE_STATE_RELATIVE_PATH,
} from "../state/packageStateStore.js";

import {
  WriteLock,
} from "../synchronization/writeLock.js";

interface MetadataSnapshot {
  readonly state:
    PackageState;

  readonly cache:
    Record<
      string,
      CachedPackage
    >;

  readonly lockFile:
    LockFile;
}

export interface PackageUninstallMetadataExecution {
  readonly packageId:
    string;

  readonly expectedState:
    PackageState;

  readonly expectedReceipt:
    PackageStateReceipt;

  readonly transaction:
    FileTransaction;

  readonly mutateProject:
    () => Promise<void>;

  /*
   * Optional so existing direct callers using a legacy
   * FileTransaction remain source-compatible.
   */
  readonly verifyProject?:
    (
      state: PackageState
    ) => Promise<void>;
}

export class PackageUninstallMetadataCoordinator {
  private readonly pathBoundary:
    ProjectPathBoundary;

  private readonly writeLock =
    new WriteLock();

  constructor(
    projectPath: string
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  async execute(
    execution:
      PackageUninstallMetadataExecution
  ): Promise<void> {
    let writeLockHeld =
      false;

    try {
      await this.writeLock
        .acquire();

      writeLockHeld =
        true;

      const current =
        await this
          .readMetadata();

      this.assertPlanStillCurrent(
        execution,
        current
      );

      await execution.transaction
        .recordModifiedFile(
          this.pathBoundary.resolve(
            PACKAGE_STATE_RELATIVE_PATH
          )
        );

      await execution.transaction
        .recordModifiedFile(
          this.pathBoundary.resolve(
            ".aurora/cache.json"
          )
        );

      await execution.transaction
        .recordModifiedFile(
          this.pathBoundary.resolve(
            "aurora.lock"
          )
        );

      if (
        execution.transaction
          instanceof
            DurableFileTransaction
      ) {
        await execution.transaction
          .beginMutation();
      }

      await execution
        .mutateProject();

      const nextState:
        PackageState = {
          schemaVersion:
            current.state
              .schemaVersion,

          packages: {
            ...current.state
              .packages,
          },
        };

      delete nextState
        .packages[
          execution.packageId
        ];

      const nextCache = {
        ...current.cache,
      };

      delete nextCache[
        execution.packageId
      ];

      const nextLock:
        LockFile = {
          packages: {
            ...current.lockFile
              .packages,
          },
        };

      delete nextLock
        .packages[
          execution.packageId
        ];

      await this.writeState(
        nextState
      );

      await this.writeCache(
        nextCache
      );

      await this.writeLockFile(
        nextLock
      );

      if (
        execution.transaction
          instanceof
            DurableFileTransaction
      ) {
        await execution.transaction
          .beginVerification();
      }

      await this
        .assertFinalMetadata(
          nextState,
          nextCache,
          nextLock
        );

      await execution
        .verifyProject?.(
          nextState
        );

      if (
        execution.transaction
          instanceof
            DurableFileTransaction
      ) {
        await execution.transaction
          .commitDurably();
      }
      else {
        execution.transaction
          .commit();
      }
    }
    catch (error) {
      /*
       * Rollback is intentionally performed while the
       * process-wide WriteLock remains held. Existing
       * CacheManager, LockManager, and PackageStateStore
       * writers use the same static lock, so they cannot
       * interleave with restoration of these three
       * metadata files.
       */
      await execution.transaction
        .rollback();

      throw error;
    }
    finally {
      if (writeLockHeld) {
        this.writeLock
          .release();
      }
    }
  }

  private async assertFinalMetadata(
    expectedState:
      PackageState,
    expectedCache:
      Record<
        string,
        CachedPackage
      >,
    expectedLock:
      LockFile
  ): Promise<void> {
    const actual =
      await this
        .readMetadata();

    if (
      canonicalState(
        actual.state
      ) !==
        canonicalState(
          expectedState
        ) ||
      canonicalJson(
        actual.cache
      ) !==
        canonicalJson(
          expectedCache
        ) ||
      canonicalJson(
        actual.lockFile
      ) !==
        canonicalJson(
          expectedLock
        )
    ) {
      throw new Error(
        "Uninstall metadata verification failed after persistence."
      );
    }
  }

  private assertPlanStillCurrent(
    execution:
      PackageUninstallMetadataExecution,
    current:
      MetadataSnapshot
  ): void {
    if (
      canonicalState(
        current.state
      ) !==
      canonicalState(
        execution.expectedState
      )
    ) {
      throw new Error(
        `Cannot safely uninstall '${execution.packageId}' because package ownership state changed after uninstall planning.`
      );
    }

    const receipt =
      current.state
        .packages[
          execution.packageId
        ];

    if (
      !receipt ||
      canonicalReceipt(
        receipt
      ) !==
      canonicalReceipt(
        execution.expectedReceipt
      )
    ) {
      throw new Error(
        `Cannot safely uninstall '${execution.packageId}' because its ownership receipt changed after verification.`
      );
    }

    const cached =
      current.cache[
        execution.packageId
      ];

    if (
      !cached ||
      cached.version !==
        execution
          .expectedReceipt
          .version
    ) {
      throw new Error(
        `Cannot safely uninstall '${execution.packageId}' because its cache metadata no longer matches the ownership receipt.`
      );
    }

    const lockedVersion =
      current.lockFile
        .packages[
          execution.packageId
        ];

    if (
      lockedVersion !==
      execution
        .expectedReceipt
        .version
    ) {
      throw new Error(
        `Cannot safely uninstall '${execution.packageId}' because its lock metadata no longer matches the ownership receipt.`
      );
    }
  }

  private async readMetadata():
    Promise<MetadataSnapshot> {
    const stateContent =
      await fs.readFile(
        this.pathBoundary.resolve(
          PACKAGE_STATE_RELATIVE_PATH
        ),
        "utf8"
      );

    if (
      Buffer.byteLength(
        stateContent,
        "utf8"
      ) >
      PACKAGE_STATE_MAX_BYTES
    ) {
      throw new TypeError(
        "Aurora package state exceeds the maximum supported size."
      );
    }

    const state =
      parsePackageState(
        parseJson(
          stateContent,
          "package state"
        )
      );

    const cache =
      parseCache(
        parseJson(
          await fs.readFile(
            this.pathBoundary.resolve(
              ".aurora/cache.json"
            ),
            "utf8"
          ),
          "package cache"
        )
      );

    const lockFile =
      parseLock(
        parseJson(
          await fs.readFile(
            this.pathBoundary.resolve(
              "aurora.lock"
            ),
            "utf8"
          ),
          "package lock"
        )
      );

    return {
      state,
      cache,
      lockFile,
    };
  }

  private async writeState(
    state: PackageState
  ): Promise<void> {
    const normalized =
      normalizeState(
        parsePackageState(
          state
        )
      );

    const serialized =
      `${JSON.stringify(
        normalized,
        null,
        2
      )}\n`;

    if (
      Buffer.byteLength(
        serialized,
        "utf8"
      ) >
      PACKAGE_STATE_MAX_BYTES
    ) {
      throw new TypeError(
        "Aurora package state exceeds the maximum supported size."
      );
    }

    await fs.writeFile(
      this.pathBoundary.resolve(
        PACKAGE_STATE_RELATIVE_PATH
      ),
      serialized,
      {
        encoding:
          "utf8",

        mode:
          0o600,
      }
    );
  }

  private async writeCache(
    cache:
      Record<
        string,
        CachedPackage
      >
  ): Promise<void> {
    await fs.writeFile(
      this.pathBoundary.resolve(
        ".aurora/cache.json"
      ),
      JSON.stringify(
        cache,
        null,
        2
      ),
      "utf8"
    );
  }

  private async writeLockFile(
    lockFile: LockFile
  ): Promise<void> {
    await fs.writeFile(
      this.pathBoundary.resolve(
        "aurora.lock"
      ),
      JSON.stringify(
        lockFile,
        null,
        2
      ),
      "utf8"
    );
  }
}

function parseJson(
  content: string,
  label: string
): unknown {
  try {
    return JSON.parse(
      content
    );
  }
  catch {
    throw new TypeError(
      `Aurora ${label} contains invalid JSON.`
    );
  }
}

function parseCache(
  value: unknown
): Record<
  string,
  CachedPackage
> {
  if (
    typeof value !==
      "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "Aurora package cache must contain a JSON object."
    );
  }

  const cache =
    value as
      Record<
        string,
        unknown
      >;

  for (
    const [
      packageId,
      candidate,
    ]
    of Object.entries(
      cache
    )
  ) {
    if (
      typeof candidate !==
        "object" ||
      candidate === null ||
      Array.isArray(
        candidate
      )
    ) {
      throw new TypeError(
        `Aurora package cache entry '${packageId}' is invalid.`
      );
    }

    const version =
      (
        candidate as {
          version?: unknown;
        }
      ).version;

    if (
      typeof version !==
        "string" ||
      version.length ===
        0
    ) {
      throw new TypeError(
        `Aurora package cache entry '${packageId}' has an invalid version.`
      );
    }
  }

  return value as
    Record<
      string,
      CachedPackage
    >;
}

function parseLock(
  value: unknown
): LockFile {
  if (
    typeof value !==
      "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "Aurora package lock must contain a JSON object."
    );
  }

  const packages =
    (
      value as {
        packages?: unknown;
      }
    ).packages;

  if (
    typeof packages !==
      "object" ||
    packages === null ||
    Array.isArray(packages)
  ) {
    throw new TypeError(
      "Aurora package lock packages must contain a JSON object."
    );
  }

  for (
    const [
      packageId,
      version,
    ]
    of Object.entries(
      packages
    )
  ) {
    if (
      typeof version !==
        "string" ||
      version.length ===
        0
    ) {
      throw new TypeError(
        `Aurora package lock entry '${packageId}' has an invalid version.`
      );
    }
  }

  return {
    packages:
      packages as
        Record<
          string,
          string
        >,
  };
}

function canonicalState(
  state: PackageState
): string {
  return JSON.stringify(
    normalizeState(
      state
    )
  );
}

function canonicalJson(
  value: unknown
): string {
  return JSON.stringify(
    normalizeJson(
      value
    )
  );
}

function normalizeJson(
  value: unknown
): unknown {
  if (Array.isArray(value)) {
    return value.map(
      normalizeJson
    );
  }

  if (
    typeof value ===
      "object" &&
    value !== null
  ) {
    const normalized:
      Record<
        string,
        unknown
      > = {};

    for (
      const key
      of Object.keys(
        value
      ).sort(
        compareText
      )
    ) {
      normalized[key] =
        normalizeJson(
          (
            value as
              Record<
                string,
                unknown
              >
          )[key]
        );
    }

    return normalized;
  }

  return value;
}

function canonicalReceipt(
  receipt:
    PackageStateReceipt
): string {
  return JSON.stringify({
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
  });
}

function normalizeState(
  state: PackageState
): PackageState {
  const packages:
    PackageState["packages"] =
      {};

  for (
    const packageId
    of Object.keys(
      state.packages
    ).sort(
      compareText
    )
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
