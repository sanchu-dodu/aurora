import {
  PackageRegistry,
} from "../registry/registry.js";

import {
  PackageStateStore,
} from "../state/packageStateStore.js";

import {
  InstalledStateVerifier,
} from "../verify/installedStateVerifier.js";

import {
  PackageUpdateCoordinator,
} from "./packageUpdateCoordinator.js";

import {
  UpdatePlanner,
  type UpdateStep,
} from "./updatePlanner.js";


export interface UpdateResult {
  package: string;

  currentVersion: string;

  latestVersion: string;

  updateAvailable: boolean;

  plan:
    UpdateStep[];
}


export class UpdateManager {
  private readonly registry =
    new PackageRegistry();

  private readonly planner =
    new UpdatePlanner();

  private readonly verifier =
    new InstalledStateVerifier();

  private readonly coordinator =
    new PackageUpdateCoordinator();


  async check(
    packageId: string,
    projectPath: string
  ): Promise<
    UpdateResult
  > {
    /*
     * The ownership receipt is the installed-version
     * authority. InstalledStateVerifier additionally
     * requires cache and aurora.lock to agree.
     */
    await this.verifier.verify(
      packageId,
      projectPath
    );

    const receipt =
      await new PackageStateStore(
        projectPath
      ).getReceipt(
        packageId
      );

    if (!receipt) {
      throw new Error(
        `${packageId} is not installed`
      );
    }

    const manifest =
      await this.registry.getPackage(
        packageId
      );

    const latest =
      manifest.version;

    const plan =
      this.planner.createPlan(
        packageId,
        receipt.version,
        latest
      );

    return {
      package:
        packageId,

      currentVersion:
        receipt.version,

      latestVersion:
        latest,

      updateAvailable:
        plan.length > 0,

      plan,
    };
  }


  async executeUpdate(
    packageId: string,
    projectPath: string,
    currentVersion: string,
    targetVersion: string
  ): Promise<void> {
    await this.coordinator.execute(
      packageId,
      projectPath,
      currentVersion,
      targetVersion
    );
  }
}
