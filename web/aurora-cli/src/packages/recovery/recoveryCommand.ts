import { RecoveryManager } from "./recoveryManager.js";
import { RecoveryExecutor } from "./recoveryExecutor.js";


export async function recoveryListCommand(): Promise<void> {


  const manager =
    new RecoveryManager(
      process.cwd()
    );


  const transactions =
    await manager.findIncomplete();



  console.log();

  console.log(
    "Incomplete Transactions"
  );

  console.log(
    "======================="
  );

  console.log();



  if (
    transactions.length === 0
  ) {

    console.log(
      "No recovery required."
    );

    console.log();

    return;

  }



  for (
    const transaction of transactions
  ) {


    console.log(
      `Package: ${transaction.package}`
    );


    console.log(
      `From: ${transaction.fromVersion}`
    );


    console.log(
      `To: ${transaction.toVersion}`
    );


    console.log(
      `Status: ${transaction.status}`
    );


    console.log();

  }


}




export async function recoveryRollbackCommand(
  packageId: string
): Promise<void> {


  const executor =
    new RecoveryExecutor(
      process.cwd()
    );


  await executor.rollback(
    packageId
  );


}