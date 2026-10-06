import { z } from "zod";
import { normalizePlanPath } from "../operations/operationPlan.js";
import { AuroraError } from "../errors/AuroraError.js";
import { ErrorCodes } from "../errors/errorCodes.js";

const Identifier = z.string().max(128).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
const Version = z.string().max(128).regex(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u);
const Identity = z.object({ id: Identifier, version: Version }).strict();
const ManagedFile = z.object({
  path: z.string().max(4096).refine(value => {
    try {
      return normalizePlanPath(value) === value && !/^(?:\.git|\.aurora)(?:\/|$)/iu.test(value);
    } catch { return false; }
  }, "Expected a canonical project-relative source path."),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export const SolutionStateSchema = z.object({
  schemaVersion: z.literal(1),
  solution: Identity,
  template: Identity,
  capabilities: z.array(z.object({
    ...Identity.shape,
    files: z.array(ManagedFile).min(1).max(128),
  }).strict()).max(64),
}).strict().superRefine((state, context) => {
  const ids = state.capabilities.map(capability => capability.id);
  const paths = state.capabilities.flatMap(capability => capability.files.map(file => file.path.toLowerCase()));
  if (paths.length > 512) {
    context.addIssue({ code: "custom", message: "Managed file inventory is limited to 512 paths." });
    return;
  }
  const overlap = paths.some((left, index) => paths.slice(index + 1).some(right =>
    left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)));
  if (new Set(ids).size !== ids.length || overlap) {
    context.addIssue({ code: "custom", message: "Capability identities and managed paths must be unique and non-overlapping." });
  }
});

export type SolutionState = z.infer<typeof SolutionStateSchema>;

export function parseSolutionState(value: unknown): SolutionState {
  const result = SolutionStateSchema.safeParse(value);
  if (result.success) return result.data;
  // Do not echo arbitrary local metadata or parser values.
  throw new AuroraError("Solution metadata is invalid.", {
    code: ErrorCodes.INVALID_SOLUTION_STATE,
    suggestion: "Review .aurora/solution.json against trusted project history; no repair was attempted.",
  });
}
