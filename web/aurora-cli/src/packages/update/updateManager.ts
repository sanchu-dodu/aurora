import { PackageRegistry } from "../registry/registry.js";
import { CacheManager } from "../cache/cacheManager.js";
import { UpdatePlanner } from "./updatePlanner.js";
import { BackupManager } from "../backup/backupManager.js";
import { RollbackManager } from "../rollback/rollbackManager.js";
import { UpdateExecutor } from "./updateExecutor.js";
import { InstallerContext } from "../installer/installerContext.js";
import { TransactionManager } from "../transaction/transactionManager.js";

export interface UpdateResult {

  package: string;

  currentVersion: string;

  latestVersion: string;

  updateAvailable: boolean;

  backup?: string;

  plan: {

    package: string;

    currentVersion: string;

    targetVersion: string;

  }[];

}



export class UpdateManager {


  private registry =
    new PackageRegistry();


  private planner =
    new UpdatePlanner();



  async check(
    packageId: string,
    projectPath: string
  ): Promise<UpdateResult> {


    const cache =
      new CacheManager(
        projectPath
      );


    const installed =
      await cache.read();


    const current =
      installed[packageId];


    if (!current) {

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
        current.version,
        latest
      );


    let backup: string | undefined;


    if (
      current.version !== latest
    ) {


      const backupManager =
        new BackupManager(
          projectPath
        );


      backup =
        await backupManager.createBackup();

    }



    return {

      package: packageId,

      currentVersion:
        current.version,

      latestVersion:
        latest,

      updateAvailable:
        current.version !== latest,

      backup,

      plan

    };


  }





  async executeUpdate(
  packageId: string,
  projectPath: string,
  backupPath: string,
  currentVersion: string,
  targetVersion: string
): Promise<void> {


  const context =
    new InstallerContext(
      projectPath
    );


  const executor =
    new UpdateExecutor();


  const rollback =
    new RollbackManager(
      projectPath
    );


  const transactions =
    new TransactionManager(
      projectPath
    );


  const transactionId =
    `update-${packageId}-${Date.now()}`;



  await transactions.create({

    id: transactionId,

    package: packageId,

    fromVersion:
      currentVersion,

    toVersion:
      targetVersion,

    status:
      "started",

    startedAt:
      new Date().toISOString(),

    backup:
      backupPath

  });



  try {


    await executor.execute(
      packageId,
      context
    );



    await transactions.update(
      transactionId,
      {

        status:
          "completed",

        finishedAt:
          new Date().toISOString()

      }
    );


    console.log(
      "Update completed successfully."
    );


  } catch(error) {


    console.log(
      "Update failed."
    );


    console.log(
      "Starting rollback..."
    );


    await rollback.rollback(
      backupPath
    );


    await transactions.update(
      transactionId,
      {

        status:
          "rolled_back",

        finishedAt:
          new Date().toISOString()

      }
    );


    throw error;

  }


}
}
