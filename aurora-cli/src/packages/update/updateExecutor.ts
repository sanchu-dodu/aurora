import { PackageWorker } from "../installation/packageWorker.js";
import { InstallerContext } from "../installer/installerContext.js";


export class UpdateExecutor {


  async execute(
    packageId: string,
    context: InstallerContext
  ): Promise<void> {


    const worker =
      new PackageWorker();


    await worker.install(
      packageId,
      context
    );


  }


}