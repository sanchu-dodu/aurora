import { createHash } from "node:crypto";
import fs from "node:fs";
import { z } from "zod";

import { AuroraConfigSchema, defaultConfig } from "../config/defaults.js";
import { inspectOperationJournals } from "../operations/operationJournal.js";
import { ProjectPathBoundary } from "../security/projectPathBoundary.js";
import { readProjectMetadata } from "./projectMetadata.js";
import { parseSolutionState, type SolutionState } from "../solutions/solutionState.js";
import { inspectSolutionCapabilityFiles, type CapabilityInspection } from "../solutions/capabilityInspection.js";
import { parsePackageState } from "../packages/state/packageStateSchema.js";
import {
  calculateOfficialRegistryLockEntryDigest,
  parseLockFile,
} from "../packages/lock/lockSchema.js";
import {
  parseLifecycleJournalEnvelope,
  parseLifecycleTransactionId,
} from "../packages/lifecycle/lifecycleJournalSchema.js";
import type { PackageManager } from "../services/packageManagerService.js";
import { getPackageManager } from "../services/packageManagerService.js";

export interface ProjectDiagnostic {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail" | "skip";
  readonly message: string;
  readonly suggestion?: string;
}

const Identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9@][a-zA-Z0-9@/._-]*$/u);
const NodePackageName = z.string().min(1).max(214)
  .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu);
const Manager = z.enum(["npm", "pnpm", "yarn", "bun"]);
const ProjectManifest = z.object({
  projectName: Identifier,
  framework: Identifier,
  language: z.enum(["javascript", "typescript"]),
  packageManager: Manager,
  installDependencies: z.boolean(),
  initializeGit: z.boolean(),
}).strict();
const DependencyMap = z.record(NodePackageName, z.string().min(1).max(2048));
const NodeManifest = z.object({
  name: NodePackageName.optional(),
  packageManager: z.string().max(256).optional(),
  engines: z.object({ node: z.string().max(256).optional() }).optional(),
  dependencies: DependencyMap.optional(),
  devDependencies: DependencyMap.optional(),
  optionalDependencies: DependencyMap.optional(),
  peerDependencies: DependencyMap.optional(),
  scripts: z.record(z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f-\u009f]+$/u), z.string()).optional(),
});
const FeatureManifest = z.object({
  installed: z.array(Identifier).max(4096)
    .refine(values => new Set(values).size === values.length),
}).strict();

export interface ProjectInspection {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly kind: "aurora" | "node" | "directory";
  readonly healthy: boolean;
  readonly project: z.infer<typeof ProjectManifest> | null;
  readonly node: {
    readonly name: string | null;
    readonly requiredVersion: string | null;
    readonly scripts: readonly string[];
    readonly dependencies: Readonly<Record<
      "runtime" | "development" | "optional" | "peer", readonly string[]
    >>;
  } | null;
  readonly packageManager: PackageManager;
  readonly features: readonly string[];
  readonly solution: SolutionState | null;
  readonly capabilityChecks: readonly CapabilityInspection[];
  readonly installedPackages: readonly { readonly id: string; readonly version: string }[];
  readonly lockedPackages: readonly {
    readonly id: string;
    readonly version: string;
    readonly source: "official-registry" | "legacy";
  }[];
  readonly pendingTransactions: number | null;
  readonly pendingOperationPlans: number | null;
  readonly diagnostics: readonly ProjectDiagnostic[];
}

const MAX_JOURNALS = 128;

/**
 * Bounded metadata read, with no project code execution or writes.
 * Keep the descriptor bound to the checked file, and reject changes while reading.
 */
function readJson(boundary: ProjectPathBoundary, relative: string): unknown | undefined {
  return readProjectMetadata(boundary, relative)?.value;
}

/** Inspect exactly this root; never search parents or synthesize project files. */
export function inspectProject(projectRoot: string): ProjectInspection {
  const diagnostics: ProjectDiagnostic[] = [];
  const boundary = new ProjectPathBoundary(projectRoot);
  const add = (id: string, status: ProjectDiagnostic["status"], message: string, suggestion?: string) => {
    diagnostics.push({ id, status, message, ...(suggestion ? { suggestion } : {}) });
  };
  function section<T>(id: string, file: string, parse: (value: unknown) => T): T | null {
    try {
      const value = readJson(boundary, file);
      if (value === undefined) {
        add(id, "skip", `No ${file} present.`);
        return null;
      }
      const parsed = parse(value);
      add(id, "pass", `${file} has valid metadata.`);
      return parsed;
    } catch {
      // Parser errors may contain credential values or untrusted terminal escapes.
      add(id, "fail", `${file} is invalid, unsafe, unreadable, or exceeds the metadata limit.`,
        "Inspect this file locally and restore valid metadata from a trusted revision; no repair was attempted.");
      return null;
    }
  }

  const project = section("project.manifest", "aurora.config.json", value => ProjectManifest.parse(value));
  const node = section("project.node", "package.json", value => NodeManifest.parse(value));
  const config = section("project.config", ".aurora/config.json", value => {
    const object = z.record(z.string(), z.unknown()).parse(value);
    return AuroraConfigSchema.parse({ ...defaultConfig, ...object });
  });
  const features = section("project.features", ".aurora/features.json", value => FeatureManifest.parse(value));
  const solution = section("project.solution", ".aurora/solution.json", parseSolutionState);
  const state = section("project.packages", ".aurora/package-state.json", parsePackageState);
  const lock = section("project.lock", "aurora.lock", parseLockFile);
  const capabilityReport = solution ? inspectSolutionCapabilityFiles(boundary, solution) : null;
  diagnostics.push(...capabilityReport?.diagnostics ?? []);

  let declaredManager: PackageManager | undefined;
  if (node?.packageManager) {
    const match = /^(npm|pnpm|yarn|bun)@[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.+-]+)?$/u.exec(node.packageManager);
    if (match) declaredManager = Manager.parse(match[1]);
    else add("project.package-manager", "fail", "package.json has an unsupported packageManager declaration.",
      "Use a supported manager with an exact version, for example npm@11.0.0.");
  }
  const packageManager = project?.packageManager ?? declaredManager ?? config?.packageManager ?? "npm";
  if (project && declaredManager && project.packageManager !== declaredManager) {
    add("project.package-manager-conflict", "fail", "Project and package.json select different package managers.",
      "Align aurora.config.json and package.json before installing dependencies.");
  }

  if (node) {
    try {
      const presentManagers = (["npm", "pnpm", "yarn", "bun"] as const).filter(manager =>
        getPackageManager(manager).lockFiles.map(file => {
          const target = boundary.resolve(file);
          try {
            if (!fs.lstatSync(target).isFile()) throw new Error("Invalid dependency lock.");
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
            throw error;
          }
        }).some(Boolean));
      if (presentManagers.some(manager => manager !== packageManager)) {
        add("project.dependency-lock", "warn", "A dependency lockfile belongs to a different package manager.",
          "Choose one package manager and review its lockfile before installing.");
      } else {
        add("project.dependency-lock", presentManagers.length ? "pass" : "warn",
          presentManagers.length ? "Selected package-manager lockfile is present (contents not verified)." :
            "No dependency lockfile is present.", presentManagers.length ? undefined :
            "Generate and commit a dependency lockfile using the selected package manager.");
      }
    } catch {
      add("project.dependency-lock", "fail", "A dependency lockfile path is unsafe or unreadable.");
    }
  }

  const installedPackages = Object.values(state?.packages ?? {})
    .map(receipt => ({ id: receipt.id, version: receipt.version }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const lockedPackages = Object.entries(lock?.packages ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([id, entry]) => ({
      id, version: typeof entry === "string" ? entry : entry.version,
      source: typeof entry === "string" ? "legacy" as const : "official-registry" as const,
    }));
  if (state && lock) {
    const mismatched = Object.values(state.packages).some(receipt => {
      const entry = lock.packages[receipt.id];
      if (!entry || (typeof entry === "string" ? entry : entry.version) !== receipt.version) return true;
      if (typeof entry === "string") return receipt.officialLockSha256 !== undefined;
      return receipt.officialLockSha256 !== calculateOfficialRegistryLockEntryDigest(entry) ||
        receipt.artifactSha256 !== entry.packageArtifact.digest || receipt.publisherId !== entry.publisher.id;
    });
    add("project.package-consistency", mismatched ? "fail" : "pass",
      mismatched ? "Installed receipts disagree with aurora.lock." : "Installed receipt identities agree with aurora.lock.",
      mismatched ? "Review trusted lock and receipt history before running package verification or recovery." : undefined);
    if (lockedPackages.some(entry => !Object.hasOwn(state.packages, entry.id))) {
      add("project.uninstalled-lock", "warn", "Some locked packages have no installation receipt.",
        "Install from trusted locked inputs when ready; inspection does not install packages.");
    }
  } else if (installedPackages.length && !lock) {
    add("project.package-consistency", "fail", "Installed receipts cannot be checked without a valid aurora.lock.",
      "Restore the trusted project lockfile before updating packages.");
  } else if (lockedPackages.length && !state) {
    add("project.uninstalled-lock", "warn", "Locked packages have no readable installation receipts.");
  }

  let pendingTransactions: number | null = 0;
  try {
    const journalRoot = boundary.resolve(".aurora/lifecycle-journal");
    const entries: fs.Dirent[] = [];
    let directory: fs.Dir | undefined;
    try {
      directory = fs.opendirSync(journalRoot);
      let entry: fs.Dirent | null;
      while ((entry = directory.readSync()) !== null) {
        if (entries.length === MAX_JOURNALS) throw new Error("Journal inspection limit exceeded.");
        entries.push(entry);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    } finally {
      directory?.closeSync();
    }
    const rootDigest = createHash("sha256").update(boundary.projectRoot, "utf8").digest("hex");
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Unsafe journal directory.");
      if (entry.name === "recovered") continue;
      const id = parseLifecycleTransactionId(entry.name);
      const journal = parseLifecycleJournalEnvelope(readJson(boundary, `.aurora/lifecycle-journal/${id}/journal.json`));
      if (journal.transactionId !== id || journal.projectRootSha256 !== rootDigest) {
        throw new Error("Journal binding mismatch.");
      }
      if (journal.phase !== "committed") pendingTransactions++;
    }
    add("project.transactions", pendingTransactions ? "warn" : "pass",
      pendingTransactions ? "Uncommitted lifecycle transactions are present; they may be active or interrupted." :
        "No uncommitted lifecycle journal metadata found.",
      pendingTransactions ? "Let active operations finish. Review recovery state if an operation was interrupted; do not delete journals." : undefined);
  } catch {
    pendingTransactions = null;
    add("project.transactions", "fail", "Lifecycle journal metadata cannot be safely inspected.",
      "Review journal integrity or the inspection limit (128 entries) before package mutations; do not delete recovery data.");
  }

  let pendingOperationPlans: number | null = 0;
  try {
    pendingOperationPlans = inspectOperationJournals(boundary.projectRoot)
      .filter(journal => journal.phase !== "committed").length;
    add("project.operation-plans", pendingOperationPlans ? "fail" : "pass",
      pendingOperationPlans ? "Uncommitted operation-plan transactions are present; they may be active or interrupted." :
        "No uncommitted operation-plan journal metadata found.",
      pendingOperationPlans ? "Let active operations finish. Use explicit plan recovery for interrupted operations before project mutations; do not delete journals." : undefined);
  } catch {
    pendingOperationPlans = null;
    add("project.operation-plans", "fail", "Operation-plan journal metadata cannot be safely inspected.",
      "Review journal integrity or the inspection limit (128 entries) before project mutations; do not delete recovery data.");
  }

  return {
    schemaVersion: 1,
    root: boundary.projectRoot,
    kind: project || config || features || solution || state || lock ? "aurora" : node ? "node" : "directory",
    healthy: !diagnostics.some(check => check.status === "fail"),
    project,
    node: node ? {
      name: node.name ?? null,
      requiredVersion: node.engines?.node ?? null,
      scripts: Object.keys(node.scripts ?? {}).sort(),
      dependencies: {
        runtime: Object.keys(node.dependencies ?? {}).sort(),
        development: Object.keys(node.devDependencies ?? {}).sort(),
        optional: Object.keys(node.optionalDependencies ?? {}).sort(),
        peer: Object.keys(node.peerDependencies ?? {}).sort(),
      },
    } : null,
    packageManager,
    features: [...features?.installed ?? []].sort(),
    solution,
    capabilityChecks: capabilityReport?.capabilities ?? [],
    installedPackages,
    lockedPackages,
    pendingTransactions,
    pendingOperationPlans,
    diagnostics,
  };
}
