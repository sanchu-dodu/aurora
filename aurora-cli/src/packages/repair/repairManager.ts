import fs from "node:fs/promises";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  PackageWorker,
  type PackageWorkerLifecycleResult,
  type PackageWorkerRepairOptions,
} from "../installation/packageWorker.js";

import {
  InstallerContext,
} from "../installer/installerContext.js";

import {
  DurableFileTransaction,
} from "../lifecycle/durableFileTransaction.js";

import {
  LifecycleRecoveryManager,
} from "../lifecycle/lifecycleRecoveryManager.js";

import {
  ProjectLifecycleLock,
} from "../lifecycle/projectLifecycleLock.js";

import {
  PACKAGE_STATE_MAX_BYTES,
  parsePackageState,
  parsePackageStateReceipt,
  type PackageState,
  type PackageStateReceipt,
} from "../state/packageStateSchema.js";

import {
  WriteLock,
} from "../synchronization/writeLock.js";

import {
  mergePackageOwnershipReceipts,
} from "../update/packageOwnershipTransition.js";

import {
  InstalledStateVerifier,
} from "../verify/installedStateVerifier.js";


interface PackageWorkerLike {
  install(
    packageId: string,
    context: InstallerContext,
    options:
      PackageWorkerRepairOptions
  ): Promise<
    void |
    PackageWorkerLifecycleResult
  >;
}


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


interface CacheEntry {
  version?: string;

  installedAt?: string;

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


interface RepairMetadata {
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


export class RepairManager {
  constructor(
    private readonly worker:
      PackageWorkerLike =
        new PackageWorker(),

    private readonly verifier:
      InstalledStateVerifierLike =
        new InstalledStateVerifier(),

    private readonly writeLock:
      WriteLockLike =
        new WriteLock()
  ) {}


  async repair(
    packageId: string,
    projectPath: string
  ): Promise<void> {
    const lifecycleLock =
      await ProjectLifecycleLock
        .acquire(
          projectPath
        );

    let writeLockHeld =
      false;

    let transaction:
      DurableFileTransaction |
      undefined;

    try {
      /*
       * An interrupted package lifecycle may be the
       * cause of the apparent damage. Recover it under
       * the same outer lock before deciding whether a
       * new repair transaction is necessary.
       */
      await new LifecycleRecoveryManager(
        projectPath
      ).recoverIncomplete(
        lifecycleLock
      );

      try {
        await this.verifier.verify(
          packageId,
          projectPath
        );

        console.log();
        console.log(
          "Package is healthy."
        );

        console.log(
          "No repair needed."
        );

        return;
      }
      catch (error) {
        if (
          !isInstalledStateFailure(
            error
          )
        ) {
          throw error;
        }

        console.log();
        console.log(
          "Repairing package..."
        );
      }

      await this.writeLock
        .acquire();

      writeLockHeld =
        true;

      transaction =
        await DurableFileTransaction
          .begin({
            operationName:
              "package repair",

            operation:
              "repair",

            packageIds: [
              packageId,
            ],

            projectPath,
          });

      const context =
        new InstallerContext(
          projectPath,
          transaction
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
       * Capture the complete lifecycle metadata set
       * before package-controlled code receives a
       * mutation-capable context.
       */
      await transaction
        .recordModifiedFile(
          statePath
        );

      await transaction
        .recordModifiedFile(
          cachePath
        );

      await transaction
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

      const remainingPackages =
        Object.keys(
          metadata.state.packages
        )
          .filter(
            id =>
              id !==
              packageId
          )
          .sort(compareText);

      /*
       * Repair is allowed to replace only the damaged
       * package. Prove every other ownership receipt
       * immediately before mutation.
       */
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

      await transaction
        .beginMutation();

      const execution =
        await this.worker.install(
          packageId,
          context,
          {
            mode:
              "repair",

            expectedVersion:
              metadata.receipt
                .version,

            expectedPublisherId:
              metadata.receipt
                .publisherId,

            expectedArtifactSha256:
              metadata.receipt
                .artifactSha256,
          }
        );

      if (!execution) {
        /*
         * Preserve the legacy no-false-success guarantee.
         * A test double or stale caller that performs no
         * repair receives the precise installed-state
         * failure when damage is still present.
         */
        await this.verifier
          .verifyReceipt(
            packageId,
            projectPath,
            metadata.receipt
          );

        throw new Error(
          `Package repair execution for '${packageId}' returned no ownership receipt.`
        );
      }

      this.assertExecutionIdentity(
        packageId,
        metadata.receipt,
        execution
      );

      const freshReceipt =
        parsePackageStateReceipt({
          ...execution.receipt,

          /*
           * Repair restores the existing installation;
           * it does not create a new installation event.
           */
          installedAt:
            metadata.receipt
              .installedAt,
        });

      const mergedReceipt =
        mergePackageOwnershipReceipts(
          metadata.receipt,
          freshReceipt
        );

      /*
       * Package-controlled execution must not damage
       * any other installed package. Check again before
       * publishing replacement metadata for the target.
       */
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
        ...(
          metadata.cache[
            packageId
          ] ?? {}
        ),

        version:
          mergedReceipt.version,

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
        mergedReceipt.version;

      await this.writeMetadata(
        context,
        metadata
      );

      await transaction
        .beginVerification();

      /*
       * Prove the exact bytes published by this repair,
       * then prove the repaired installed state while
       * rollback evidence and both locks are retained.
       */
      await this.assertFinalMetadata(
        statePath,
        cachePath,
        lockPath,
        packageId,
        metadata
      );

      await this.verifier
        .verifyReceipt(
          packageId,
          projectPath,
          mergedReceipt
        );

      await transaction
        .commitDurably();

      console.log();
      console.log(
        "Repair completed successfully."
      );
    }
    catch (error) {
      if (transaction) {
        await transaction
          .rollback();
      }

      throw error;
    }
    finally {
      try {
        if (writeLockHeld) {
          this.writeLock
            .release();
        }
      }
      finally {
        /*
         * Cross-process lifecycle authority is released
         * last, after durable commit or handled rollback
         * and after the inner WriteLock.
         */
        await lifecycleLock
          .release();
      }
    }
  }


  private async readMetadata(
    statePath: string,
    cachePath: string,
    lockPath: string,
    packageId: string
  ): Promise<
    RepairMetadata
  > {
    const stateContent =
      await fs.readFile(
        statePath,
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
      parseCache(
        cacheDecoded,
        packageId
      );

    const lock =
      parseLock(
        lockDecoded,
        packageId
      );

    const receipt =
      state.packages[
        packageId
      ];

    if (!receipt) {
      throw new Error(
        `Package '${packageId}' has no ownership receipt during repair.`
      );
    }

    return {
      state,
      cache,
      lock,
      receipt,
    };
  }


  private assertExecutionIdentity(
    packageId: string,
    expected:
      PackageStateReceipt,
    execution:
      PackageWorkerLifecycleResult
  ): void {
    if (
      execution.version !==
        expected.version ||
      execution.receipt.version !==
        expected.version
    ) {
      throw new Error(
        `Package '${packageId}' repair execution did not preserve installed version '${expected.version}'.`
      );
    }

    if (
      execution.receipt.id !==
        packageId
    ) {
      throw new Error(
        `Package repair execution returned ownership for '${execution.receipt.id}' instead of '${packageId}'.`
      );
    }

    if (
      execution.receipt.publisherId !==
        expected.publisherId ||
      execution.receipt.artifactSha256 !==
        expected.artifactSha256
    ) {
      throw new Error(
        `Package '${packageId}' repair execution changed its installed publisher or artifact identity.`
      );
    }
  }


  private async writeMetadata(
    context: InstallerContext,
    metadata: RepairMetadata
  ): Promise<void> {
    const state =
      normalizeState(
        parsePackageState(
          metadata.state
        )
      );

    const serializedState =
      `${JSON.stringify(
        state,
        null,
        2
      )}\n`;

    if (
      Buffer.byteLength(
        serializedState,
        "utf8"
      ) >
        PACKAGE_STATE_MAX_BYTES
    ) {
      throw new TypeError(
        "Aurora package state exceeds the maximum supported size."
      );
    }

    await fs.writeFile(
      context.resolveProjectPath(
        ".aurora/package-state.json"
      ),
      serializedState,
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


  private async assertFinalMetadata(
    statePath: string,
    cachePath: string,
    lockPath: string,
    packageId: string,
    expected:
      RepairMetadata
  ): Promise<void> {
    const actual =
      await this.readMetadata(
        statePath,
        cachePath,
        lockPath,
        packageId
      );

    if (
      canonicalJson(
        normalizeState(
          actual.state
        )
      ) !==
        canonicalJson(
          normalizeState(
            expected.state
          )
        ) ||
      canonicalJson(
        actual.cache
      ) !==
        canonicalJson(
          expected.cache
        ) ||
      canonicalJson(
        actual.lock
      ) !==
        canonicalJson(
          expected.lock
        )
    ) {
      throw new Error(
        `Package '${packageId}' repair metadata changed before final verification.`
      );
    }
  }
}


function parseCache(
  input: unknown,
  repairedPackageId: string
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
      input
    )
  ) {
    if (
      packageId ===
        repairedPackageId
    ) {
      cache[packageId] =
        typeof entry ===
          "object" &&
        entry !== null &&
        !Array.isArray(entry)
          ? {
              ...entry,
            }
          : {};

      continue;
    }

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

    cache[packageId] = {
      ...candidate,
    };
  }

  return cache;
}


function parseLock(
  input: unknown,
  repairedPackageId: string
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
      packageId ===
        repairedPackageId
    ) {
      if (
        typeof version ===
          "string"
      ) {
        packages[packageId] =
          version;
      }

      continue;
    }

    if (
      typeof version !==
        "string"
    ) {
      throw new TypeError(
        `Lock entry '${packageId}' must contain a version string.`
      );
    }

    packages[packageId] =
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
    ).sort(compareText)
  ) {
    const receipt =
      state.packages[
        packageId
      ];

    packages[packageId] = {
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


function canonicalJson(
  input: unknown
): string {
  return JSON.stringify(
    normalizeJson(input)
  );
}


function normalizeJson(
  input: unknown
): unknown {
  if (Array.isArray(input)) {
    return input.map(
      normalizeJson
    );
  }

  if (
    typeof input !== "object" ||
    input === null
  ) {
    return input;
  }

  const normalized:
    Record<
      string,
      unknown
    > = {};

  for (
    const key
    of Object.keys(input)
      .sort(compareText)
  ) {
    normalized[key] =
      normalizeJson(
        (
          input as
            Record<
              string,
              unknown
            >
        )[key]
      );
  }

  return normalized;
}


function isInstalledStateFailure(
  error: unknown
): boolean {
  return (
    error instanceof
      AuroraError &&
    error.code ===
      ErrorCodes
        .PACKAGE_INTEGRITY_FAILED
  );
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
