import { RecoveryManager } from "./recoveryManager.js";
import { RollbackManager } from "../rollback/rollbackManager.js";
import { TransactionManager } from "../transaction/transactionManager.js";


export class RecoveryExecutor {


  private recoveryManager: RecoveryManager;

  private rollbackManager: RollbackManager;

  private transactionManager: TransactionManager;



  constructor(
    private projectPath: string
  ) {

    this.recoveryManager =
      new RecoveryManager(
        projectPath
      );


    this.rollbackManager =
      new RollbackManager(
        projectPath
      );


    this.transactionManager =
      new TransactionManager(
        projectPath
      );

  }



  async rollback(
    packageId: string
  ): Promise<void> {


    const transactions =
      await this.recoveryManager.findIncomplete();



    const transaction =
      transactions.find(
        item =>
          item.package === packageId
      );



    if (!transaction) {

      throw new Error(
        `No incomplete transaction found for ${packageId}`
      );

    }



    if (!transaction.backup) {

      throw new Error(
        `No backup found for ${packageId}`
      );

    }



    console.log();

    console.log(
      `Rolling back ${packageId}...`
    );


    console.log();



    await this.rollbackManager.rollback(
      transaction.backup
    );



    await this.transactionManager.update(
      transaction.id,
      {

        status:
          "rolled_back",

        finishedAt:
          new Date().toISOString()

      }
    );



    console.log(
      "✓ Rollback completed"
    );

    console.log();


  }


}