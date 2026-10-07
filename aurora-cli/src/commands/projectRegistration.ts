import { Command } from "commander";
import { registerCommand } from "../core/commandRegistry.js";
import { inspectProject } from "../projects/index.js";
import { redactSensitiveValue } from "../security/secretRedactor.js";
import { AuroraError } from "../errors/AuroraError.js";
import { ErrorCodes } from "../errors/errorCodes.js";

registerCommand({
  id: "project", activation: "none",
  register(program: Command): void {
    program.command("project").description("Inspect the shared Aurora project model")
      .command("inspect")
      .description("Read project metadata without executing project code or modifying files")
      .option("--project <path>", "Inspect this project root", ".")
      .option("--json", "Print Project Inspection v1 as JSON")
      .action((options: { project: string; json?: boolean }) => {
        const report = inspectProject(options.project);
        if (options.json) console.log(JSON.stringify(redactSensitiveValue(report), null, 2));
        else {
          console.log("Aurora Project Inspection");
          console.log(`Type: ${report.kind}; package manager: ${report.packageManager}`);
          console.log(`Features: ${report.features.length}; installed packages: ${report.installedPackages.length}; locked packages: ${report.lockedPackages.length}`);
          if (report.solution) console.log(`Starter: ${report.solution.solution.id} ${report.solution.solution.version}; added capabilities: ${report.solution.capabilities.map(entry => entry.id).join(", ") || "none"}`);
          for (const check of report.diagnostics) {
            console.log(`[${check.status.toUpperCase()}] ${check.message}`);
            if (check.suggestion) console.log(`  ${check.suggestion}`);
          }
        }
        if (!report.healthy) throw new AuroraError("Project metadata inspection failed.", {
          code: ErrorCodes.PROJECT_INSPECTION_FAILED,
          suggestion: "Review the inspection diagnostics; no project files have been changed.",
        });
      });
  },
});
