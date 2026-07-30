import { VerifyManager } from "../verify/verifyManager.js";
import { PackageWorker } from "../installation/packageWorker.js";
import { InstallerContext } from "../installer/installerContext.js";

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

    } catch {

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

    console.log();
    console.log(
      "Repair completed successfully."
    );

  }

}