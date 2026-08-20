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
  PackageStateStore,
} from "../state/packageStateStore.js";

import {
  InstalledStateVerifier,
} from "../verify/installedStateVerifier.js";

import {
  DependencyInspector,
} from "./dependencyInspector.js";

import {
  PackageOwnershipUninstaller,
} from "./packageOwnershipUninstaller.js";

import {
  PackageUninstallMetadataCoordinator,
} from "./packageUninstallMetadataCoordinator.js";

export class UninstallManager {
  async uninstall(
    packageId: string,
    projectPath: string
  ): Promise<void> {
    const lifecycleLock =
      await ProjectLifecycleLock
        .acquire(
          projectPath
        );

    try {
      /*
       * Restore every interrupted lifecycle operation
       * before proving the state that this uninstall
       * will plan against. The outer lock remains held
       * through recovery, mutation, and completion.
       */
      await new LifecycleRecoveryManager(
        projectPath
      ).recoverIncomplete(
        lifecycleLock
      );

      const verifier =
        new InstalledStateVerifier();

      /*
       * Uninstall never attempts to "repair through"
       * drift and never mutates ownership state it
       * cannot prove.
       */
      await verifier.verify(
        packageId,
        projectPath
      );

      const state =
        await new PackageStateStore(
          projectPath
        ).read();

      const receipt =
        state.packages[
          packageId
        ];

      if (!receipt) {
        throw new Error(
          `Cannot uninstall '${packageId}' because its ownership receipt is missing.`
        );
      }

      const inspector =
        new DependencyInspector();

      const dependents =
        await inspector
          .findDependents(
            packageId,
            Object.keys(
              state.packages
            )
          );

      if (
        dependents.length >
        0
      ) {
        console.log();

        console.log(
          `Cannot uninstall ${packageId}.`
        );

        console.log(
          `Required by: ${dependents.join(", ")}`
        );

        console.log();

        return;
      }

      const transaction =
        await DurableFileTransaction
          .begin({
            operationName:
              "package uninstall",

            operation:
              "uninstall",

            packageIds: [
              packageId,
            ],

            projectPath,
          });

      let coordinatorOwnsTransaction =
        false;

      try {
        const ownership =
          new PackageOwnershipUninstaller(
            projectPath,
            transaction
          );

        /*
         * Planning is pure and must succeed completely
         * before the first project mutation is attempted.
         */
        const plan =
          ownership.createPlan(
            receipt,
            state
          );

        const coordinator =
          new PackageUninstallMetadataCoordinator(
            projectPath
          );

        coordinatorOwnsTransaction =
          true;

        await coordinator.execute({
          packageId,

          expectedState:
            state,

          expectedReceipt:
            receipt,

          transaction,

          mutateProject:
            async () => {
              await ownership.apply(
                plan
              );
            },

          verifyProject:
            async nextState => {
              for (
                const remainingPackage
                of Object.keys(
                  nextState.packages
                ).sort()
              ) {
                await verifier
                  .verifyReceipt(
                    remainingPackage,
                    projectPath,
                    nextState.packages[
                      remainingPackage
                    ]
                  );
              }
            },
        });
      }
      catch (error) {
        /*
         * Once execute() starts, the coordinator owns
         * commit and rollback. A planning failure occurs
         * earlier and is closed here while preserving the
         * incomplete journal for later recovery.
         */
        if (
          !coordinatorOwnsTransaction
        ) {
          await transaction
            .rollback();
        }

        throw error;
      }

      console.log();

      console.log(
        `${packageId} removed successfully.`
      );

      console.log();
    }
    finally {
      /*
       * Cross-process lifecycle authority is released
       * only after durable commit or handled rollback and
       * after the coordinator releases its inner lock.
       */
      await lifecycleLock
        .release();
    }
  }
}
