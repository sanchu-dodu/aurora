import { Command } from "commander";
import { registerCommand } from "../core/commandRegistry.js";
import { createSolution, getSolutionPack, inspectCapabilities, listSolutionPacks, planCapability } from "../solutions/index.js";
import { OperationPlanService } from "../operations/operationPlanService.js";
import { printOperationPlan } from "../operations/operationPlanOutput.js";
import { redactSensitiveValue } from "../security/secretRedactor.js";
import { AuroraError } from "../errors/AuroraError.js";
import { ErrorCodes } from "../errors/errorCodes.js";

registerCommand({
  id: "create", activation: "none",
  register(program: Command): void {
    program.command("create").argument("<solution>").argument("<name>")
      .description("Create an app from a bundled starter, without installing dependencies or changing Git")
      .option("--workspace <path>", "Existing directory in which to create the app", ".")
      .option("--package-manager <manager>", "npm, pnpm, or yarn", "npm")
      .option("--json", "Print the created solution as JSON")
      .action(async (id: string, name: string, options: {
        workspace: string; packageManager: "npm" | "pnpm" | "yarn"; json?: boolean;
      }) => {
        const result = await createSolution(id, name,
          { workspaceRoot: options.workspace, packageManager: options.packageManager });
        if (options.json) console.log(JSON.stringify(redactSensitiveValue(result), null, 2));
        else {
          console.log(`Created ${id}: ${result.root}`);
          console.log("No dependencies were installed and Git was not changed.");
          console.log(`Next: open the app directory, run '${options.packageManager} install', then '${options.packageManager} run dev'.`);
        }
      });
  },
});
registerCommand({
  id: "solution", activation: "none",
  register(program: Command): void {
    program.command("solution").description("Discover bundled Aurora starters")
      .command("list").option("--json", "Print solution descriptors as JSON")
      .action((options: { json?: boolean }) => {
        const packs = listSolutionPacks();
        if (options.json) console.log(JSON.stringify(packs, null, 2));
        else for (const pack of packs) console.log(`${pack.id} ${pack.version}: ${pack.name}`);
      });
  },
});
registerCommand({
  id: "capability", activation: "none",
  register(program: Command): void {
    const capability = program.command("capability").description("Preview features before adding them to a solution");
    capability.command("verify")
      .description("Check recorded feature files without repairing or overwriting them")
      .option("--project <path>", "Solution project root", ".")
      .option("--json", "Print file status and digest comparisons as JSON")
      .action((options: { project: string; json?: boolean }) => {
        const report = inspectCapabilities(options.project);
        if (options.json) console.log(JSON.stringify(redactSensitiveValue(report), null, 2));
        else {
          console.log("Aurora Capability File Check");
          for (const check of report.diagnostics) {
            console.log(`[${check.status.toUpperCase()}] ${check.message}`);
            if (check.suggestion) console.log(`  ${check.suggestion}`);
          }
          console.log("Compared local file digests only; this is not publisher authentication or a production-readiness certificate.");
        }
        if (!report.clean) throw new AuroraError("Capability files do not all match their valid recorded metadata.", {
          code: ErrorCodes.CAPABILITY_INSPECTION_FAILED,
          suggestion: "Review the reported changes and missing/unsafe files. No project files were modified.",
        });
      });
    capability.command("list").option("--solution <id>", "Bundled starter", "web-app")
      .option("--json", "Print supported capabilities as JSON")
      .action((options: { solution: string; json?: boolean }) => {
        const entries = getSolutionPack(options.solution).capabilities;
        if (options.json) console.log(JSON.stringify(entries, null, 2));
        else for (const entry of entries) console.log(`${entry.id} ${entry.version}: ${entry.description}`);
      });
    capability.command("plan").argument("<id>")
      .description("Preview a feature; saving the plan does not apply it")
      .option("--project <path>", "Solution project root", ".")
      .requiredOption("--out <file>", "Save the preview to a new JSON file")
      .option("--json", "Print the plan as JSON")
      .action(async (id: string, options: { project: string; out: string; json?: boolean }) => {
        const service = new OperationPlanService();
        const plan = await planCapability(id, { projectRoot: options.project, service });
        const output = await service.writePlanFile(plan, options.out);
        printOperationPlan(plan, options.json);
        if (!options.json) {
          console.log(`Saved plan: ${output}`);
          console.log("No feature has been added. Review this plan, then use 'aurora apply <plan> --project <app> --yes'.");
        }
      });
  },
});
