import { Command } from "commander";

import { registerCommand } from "../core/commandRegistry.js";
import { OperationRecoveryService } from "../operations/operationRecoveryService.js";
import { redactSensitiveValue } from "../security/secretRedactor.js";

import {
  recoveryListCommand,
  recoveryRollbackCommand,
} from "../packages/recovery/recoveryCommand.js";



registerCommand({
  id: "recovery",
  subcommandActivations: {
    list: "none",
    plans: "none",
    plan: "none",
  },

  register(program: Command): void {


    const recovery =
      program
        .command("recovery")
        .description(
          "Manage interrupted transactions"
        );

    recovery.command("plans")
      .description("Inspect interrupted file-plan transactions without recovering them")
      .option("--project <path>", "Project root", ".")
      .option("--json", "Print the pending recovery records as JSON")
      .action(async (options: { project: string; json?: boolean }) => {
        const report = await new OperationRecoveryService().list(options.project);
        if (options.json) console.log(JSON.stringify(redactSensitiveValue(report), null, 2));
        else if (report.transactions.length === 0) console.log("No pending file-plan recovery records.");
        else for (const transaction of report.transactions) {
          console.log(`${transaction.transactionId}: ${transaction.planId} (${transaction.phase})`);
        }
      });

    recovery.command("plan")
      .description("Recover one interrupted file plan, stopping on conflicting user edits")
      .argument("<transaction-id>")
      .option("--project <path>", "Project root", ".")
      .option("--dry-run", "Validate recovery without changing files or acquiring a lock")
      .option("--yes", "Explicitly approve rollback of this interrupted file plan")
      .option("--json", "Print the recovery result as JSON")
      .action(async (transactionId: string, options: {
        project: string; json?: boolean; yes?: boolean; dryRun?: boolean;
      }) => {
        const report = await new OperationRecoveryService().recover(transactionId, options.project,
          { approved: options.yes === true, dryRun: options.dryRun === true });
        if (options.json) console.log(JSON.stringify(redactSensitiveValue(report), null, 2));
        else console.log(report.status === "dry-run"
          ? "Recovery validated. No files were changed."
          : "The interrupted file plan was recovered. No project code was executed.");
      });



    recovery
      .command("list")
      .description(
        "List incomplete transactions"
      )
      .action(
        async () => {

          await recoveryListCommand();

        }
      );



    recovery
      .command("rollback")
      .description(
        "Rollback interrupted update"
      )
      .argument(
        "<package>"
      )
      .action(
        async (
          packageId: string
        ) => {

          await recoveryRollbackCommand(
            packageId
          );

        }
      );


  },

});
