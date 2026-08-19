import {
  FileTransaction,
} from "../../core/fileTransaction.js";

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
    /*
     * Verification is intentionally first. Uninstall
     * never attempts to "repair through" drift and never
     * mutates an ownership state it cannot prove.
     */
    await new InstalledStateVerifier()
      .verify(
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
      new FileTransaction(
        "package uninstall",
        projectPath
      );

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
    });

    console.log();

    console.log(
      `${packageId} removed successfully.`
    );

    console.log();
  }
}
