import { RecoveryManager } from "./recoveryManager.js";

export class RecoveryService {

  private readonly manager: RecoveryManager;

  constructor(
    private readonly projectPath: string = process.cwd()
  ) {

    this.manager = new RecoveryManager(
      this.projectPath
    );

  }

  async check(): Promise<void> {

    const transactions =
      await this.manager.findIncomplete();

    if (transactions.length === 0) {
      return;
    }

    console.log();
    console.log("⚠ Recovery Required");
    console.log("===================");

    for (const transaction of transactions) {

      console.log(`Package: ${transaction.package}`);
      console.log(`From: ${transaction.fromVersion}`);
      console.log(`To: ${transaction.toVersion}`);
      console.log("Status: interrupted");
      console.log();

    }

    console.log(
      "Run rollback or resume to continue."
    );

  }

}