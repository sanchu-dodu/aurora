import {
  VerifyManager,
} from "../verify/verifyManager.js";

import {
  PackageWorker,
} from "../installation/packageWorker.js";

import {
  InstallerContext,
} from "../installer/installerContext.js";

export class RepairManager {
  async repair(
    packageId: string,
    projectPath: string
  ): Promise<void> {
    const verifier =
      new VerifyManager();

    try {
      await verifier.verify(
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
    catch {
      console.log();
      console.log(
        "Repairing package..."
      );
    }

    const worker =
      new PackageWorker();

    const context =
      new InstallerContext(
        projectPath
      );

    await worker.install(
      packageId,
      context
    );

    /*
     * A repair attempt is not success.
     *
     * PackageWorker may legitimately
     * short-circuit when legacy cache
     * metadata still marks a corrupted
     * package as installed.
     *
     * Never report repair success until
     * the resulting installed state has
     * passed the ownership-aware verifier.
     */
    await verifier.verify(
      packageId,
      projectPath
    );

    console.log();
    console.log(
      "Repair completed successfully."
    );
  }
}
