import { AuroraError } from "../errors/AuroraError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import { AURORA_CLI_NODE_RANGE } from "../core/packageMetadata.js";
import { inspectProject, type ProjectDiagnostic, type ProjectInspection } from "../projects/index.js";
import { isManifestVersionRange, satisfiesManifestVersionRange } from "../packages/version/manifestVersion.js";
import { runProcess, type SafeProcessCommand, type SafeProcessRunner } from "./processService.js";
import { redactSensitiveValue } from "../security/secretRedactor.js";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

export interface DoctorCommand {
  command: SafeProcessCommand;
  args: readonly string[];
}
export type DoctorChecker = (command: DoctorCommand) => Promise<boolean>;
export interface DoctorOptions {
  readonly projectRoot?: string;
  readonly json?: boolean;
  readonly strict?: boolean;
  readonly nodeVersion?: string;
}
export interface DoctorReport {
  readonly schemaVersion: 1;
  readonly healthy: boolean;
  readonly strict: boolean;
  readonly project: ProjectInspection;
  readonly checks: readonly ProjectDiagnostic[];
}

/** Collect without console output, Aurora activation, project scripts, or repairs. */
export async function collectDoctorReport(
  options: DoctorOptions = {},
  checker?: DoctorChecker,
  processRunner: SafeProcessRunner = runProcess,
): Promise<DoctorReport> {
  const project = inspectProject(options.projectRoot ?? process.cwd());
  const checks: ProjectDiagnostic[] = [];
  let probeRoot: string | undefined;
  let checkCommand = checker;
  if (!checkCommand) {
    try {
      const base = await fs.realpath(tmpdir());
      const relative = path.relative(project.root, base);
      if (!relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
        throw new Error("The system temporary directory is inside the inspected project.");
      }
      // A local installation under node_modules can inherit project manager plugins.
      // Use a private sibling elsewhere, with no inspected-project ancestors.
      probeRoot = await fs.mkdtemp(path.join(base, "aurora-doctor-"));
      await fs.chmod(probeRoot, 0o700);
      const cwd = probeRoot;
      checkCommand = async command => {
        const result = await processRunner({
          command: command.command, args: command.args, cwd,
          excludedExecutableRoot: project.root,
          environment: {
            COREPACK_ENABLE_NETWORK: "0",
            COREPACK_ENABLE_AUTO_PIN: "0",
            COREPACK_ENABLE_PROJECT_SPEC: "0",
            COREPACK_ENV_FILE: "0",
            YARN_IGNORE_PATH: "1",
          },
          output: "ignore", timeoutMs: 10_000, rejectOnNonZero: false,
        });
        return result.exitCode === 0;
      };
    } catch {
      checks.push({
        id: "tool.probe-isolation", status: "fail",
        message: "Doctor could not create a private tool-probe directory outside the project.",
        suggestion: "Select a narrower project root or configure a writable system temporary directory outside it.",
      });
    }
  }
  const commands: { name: string; command: SafeProcessCommand }[] = [
    { name: "Git", command: "git" },
    { name: "Node.js", command: "node" },
    { name: project.packageManager, command: project.packageManager },
  ];
  try {
    for (const command of commands) {
      if (!checkCommand) {
        checks.push({
          id: `tool.${command.command}`, status: "skip",
          message: `${command.name} was not probed because directory isolation failed.`,
        });
        continue;
      }
      let available = false;
      try {
        available = await checkCommand({ command: command.command, args: ["--version"] });
      } catch {
        // Do not surface subprocess output, command errors, or inherited credentials.
      }
      checks.push({
        id: `tool.${command.command}`,
        status: available ? "pass" : "fail",
        message: available ? `${command.name} is available.` : `${command.name} is unavailable or timed out.`,
        ...(!available ? { suggestion: `Install or repair ${command.name} on PATH, then rerun doctor.` } : {}),
      });
    }
  } finally {
    if (probeRoot) {
      try { await fs.rmdir(probeRoot); }
      catch {
        checks.push({
          id: "tool.probe-cleanup", status: "warn",
          message: "Doctor could not remove its temporary probe directory.",
          suggestion: "Review leftover aurora-doctor directories in the system temporary directory.",
        });
      }
    }
  }
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const compatible = satisfiesManifestVersionRange(nodeVersion, AURORA_CLI_NODE_RANGE);
  checks.push({
    id: "runtime.node", status: compatible ? "pass" : "fail",
    message: compatible ? "Running Node.js meets Aurora CLI requirements." : "Running Node.js does not meet Aurora CLI requirements.",
    ...(!compatible ? { suggestion: `Use Node.js ${AURORA_CLI_NODE_RANGE}.` } : {}),
  });
  const requirement = project.node?.requiredVersion;
  if (requirement) {
    if (isManifestVersionRange(requirement)) {
      const satisfied = satisfiesManifestVersionRange(nodeVersion, requirement);
      checks.push({
        id: "runtime.project-node", status: satisfied ? "pass" : "fail",
        message: satisfied ? "Running Node.js meets the project's engines.node constraint." :
          "Running Node.js does not meet the project's engines.node constraint.",
        ...(!satisfied ? { suggestion: "Select a Node.js version compatible with both Aurora and package.json." } : {}),
      });
    } else {
      checks.push({
        id: "runtime.project-node", status: "warn",
        message: "The project's engines.node range uses syntax this checker cannot evaluate.",
        suggestion: "Check this constraint with your package manager; no compatibility pass is claimed.",
      });
    }
  }
  checks.push(...project.diagnostics);
  return {
    schemaVersion: 1,
    healthy: !checks.some(check => check.status === "fail" || (options.strict && check.status === "warn")),
    strict: options.strict === true, project, checks,
  };
}

export async function runDoctor(checker?: DoctorChecker, options: DoctorOptions = {}): Promise<void> {
  const report = await collectDoctorReport(options, checker);
  if (options.json) {
    console.log(JSON.stringify(redactSensitiveValue(report), null, 2));
  } else {
    console.log("\nAurora Doctor\n========================");
    for (const check of report.checks) {
      console.log(`[${check.status.toUpperCase()}] ${check.message}`);
      if (check.suggestion) console.log(`  ${check.suggestion}`);
    }
    console.log(report.healthy ? "\nDoctor checks passed." : "\nDoctor found issues requiring attention.");
  }
  if (!report.healthy) {
    const failed = report.checks.filter(check => check.status === "fail" || (options.strict && check.status === "warn"));
    throw new AuroraError(
      `Doctor checks failed: ${failed.map(check => check.id.startsWith("tool.") ? check.id.slice(5) : check.id).join(", ")}.`,
      { code: ErrorCodes.DOCTOR_CHECK_FAILED, suggestion: "Review the reported diagnostics and rerun 'aurora doctor'." },
    );
  }
}
