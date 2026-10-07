import { AuroraError } from "../errors/AuroraError.js";
import { ErrorCodes } from "../errors/errorCodes.js";

export interface SolutionPack {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly template: { readonly id: string; readonly version: string };
  readonly framework: "nextjs";
  readonly language: "typescript";
  readonly packageManagers: readonly ("npm" | "pnpm" | "yarn")[];
  readonly capabilities: readonly { readonly id: string; readonly version: string; readonly description: string }[];
}

// Bundled data only. Project metadata cannot supply executable packs or templates.
const WEB_APP: SolutionPack = {
  schemaVersion: 1, id: "web-app", version: "1.0.0", name: "Aurora Web App",
  template: { id: "nextjs", version: "1.1.0" }, framework: "nextjs", language: "typescript",
  packageManagers: ["npm", "pnpm", "yarn"],
  capabilities: [{ id: "health", version: "1.0.0",
    description: "Add a dependency-free /api/health liveness endpoint (not a database or service readiness check)." }],
};

/** Return independent descriptors; callers cannot alter the bundled catalog. */
export function listSolutionPacks(): readonly SolutionPack[] { return [structuredClone(WEB_APP)]; }

export function getSolutionPack(id: string): SolutionPack {
  const pack = listSolutionPacks().find(candidate => candidate.id === id);
  if (pack) return pack;
  throw new AuroraError("This solution is not supported by the bundled pack catalog.", {
    code: ErrorCodes.SOLUTION_NOT_SUPPORTED,
    suggestion: "Run 'aurora solution list' to see bundled starters.",
  });
}
