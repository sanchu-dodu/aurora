import type {
  InstallerContext,
} from "../installer/installerContext.js";

import {
  PackageWorker,
  type PackageWorkerUpdateResult,
} from "../installation/packageWorker.js";


interface PackageWorkerLike {
  install(
    packageId: string,
    context: InstallerContext,
    options: {
      readonly mode:
        "update";

      readonly expectedVersion:
        string;
    }
  ): Promise<
    void |
    PackageWorkerUpdateResult
  >;
}


export type UpdateExecutionResult =
  PackageWorkerUpdateResult;


export class UpdateExecutor {
  constructor(
    private readonly worker:
      PackageWorkerLike =
        new PackageWorker()
  ) {}


  async execute(
    packageId: string,
    targetVersion: string,
    context: InstallerContext
  ): Promise<
    UpdateExecutionResult
  > {
    const result =
      await this.worker.install(
        packageId,
        context,
        {
          mode:
            "update",

          expectedVersion:
            targetVersion,
        }
      );

    if (!result) {
      throw new Error(
        `Package '${packageId}' update execution returned no ownership receipt.`
      );
    }

    return result;
  }
}
