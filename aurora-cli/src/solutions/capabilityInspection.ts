import { ProjectPathBoundary } from "../security/projectPathBoundary.js";
import { MAX_PROJECT_FILE_BYTES, ProjectFileReadLimitError, readProjectFile, readProjectMetadata } from "../projects/projectMetadata.js";
import type { ProjectDiagnostic } from "../projects/projectInspection.js";
import { parseSolutionState, type SolutionState } from "./solutionState.js";

const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export type CapabilityFileStatus = "unchanged" | "modified" | "missing" | "unsafe" | "not-checked";
export interface CapabilityFileInspection {
  readonly path: string;
  readonly status: CapabilityFileStatus;
  readonly expectedSha256: string;
  readonly actualSha256?: string;
}
export interface CapabilityInspection {
  readonly id: string;
  readonly version: string;
  readonly files: readonly CapabilityFileInspection[];
}
export interface CapabilityInspectionReport {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly solution: { readonly id: string; readonly version: string } | null;
  /** A user edit is a warning, not proof that the application is broken. */
  readonly healthy: boolean;
  /** True only when valid metadata is present and all recorded files match it. */
  readonly clean: boolean;
  readonly capabilities: readonly CapabilityInspection[];
  readonly diagnostics: readonly ProjectDiagnostic[];
}

/** Compare local recorded byte digests without executing or repairing project code. */
export function inspectCapabilities(projectRoot: string): CapabilityInspectionReport {
  const boundary = new ProjectPathBoundary(projectRoot);
  try {
    const metadata = readProjectMetadata(boundary, ".aurora/solution.json");
    if (metadata) return inspectSolutionCapabilityFiles(boundary, parseSolutionState(metadata.value));
  } catch {
    // Do not reveal file contents, raw parser values, or local I/O errors.
  }
  return {
    schemaVersion: 1, root: boundary.projectRoot, solution: null, healthy: false, clean: false,
    capabilities: [], diagnostics: [{
      id: "project.capability-files", status: "fail",
      message: "Valid, safely readable .aurora/solution.json metadata is required to check capability files.",
      suggestion: "Review the solution record against trusted project history; no files were changed.",
    }],
  };
}

/** Internal shared check using the inspector's already-selected metadata snapshot. */
export function inspectSolutionCapabilityFiles(boundary: ProjectPathBoundary,
  input: SolutionState): CapabilityInspectionReport {
  const state = parseSolutionState(input);
  let readBytes = 0;
  let budgetExceeded = false;
  const capabilities: CapabilityInspection[] = [];
  const diagnostics: ProjectDiagnostic[] = [];
  for (const capability of state.capabilities) {
    const files: CapabilityFileInspection[] = [];
    for (const file of capability.files) {
      let status: CapabilityFileStatus;
      let actualSha256: string | undefined;
      if (budgetExceeded) status = "not-checked";
      else {
        try {
          const actual = readProjectFile(boundary, file.path,
            Math.min(MAX_PROJECT_FILE_BYTES, MAX_TOTAL_BYTES - readBytes),
            bytes => { readBytes += bytes; });
          if (!actual) status = "missing";
          else {
            actualSha256 = actual.sha256;
            status = actual.sha256 === file.sha256 ? "unchanged" : "modified";
          }
        } catch (error) {
          if (error instanceof ProjectFileReadLimitError) {
            budgetExceeded = true;
            status = "not-checked";
          } else status = "unsafe";
        }
      }
      files.push({ path: file.path, status, expectedSha256: file.sha256,
        ...(actualSha256 === undefined ? {} : { actualSha256 }) });
    }
    capabilities.push({ id: capability.id, version: capability.version, files });
    const count = (status: CapabilityFileStatus) => files.filter(file => file.status === status).length;
    const failures = count("missing") + count("unsafe") + count("not-checked");
    const modified = count("modified");
    diagnostics.push({
      id: `project.capability-files.${capability.id}`,
      status: failures ? "fail" : modified ? "warn" : "pass",
      message: `Capability '${capability.id}': ${count("unchanged")} unchanged, ${modified} modified, ${count("missing")} missing, ${count("unsafe")} unsafe or unreadable, ${count("not-checked")} not checked.`,
      ...(failures ? { suggestion:
        "Review missing/unsafe paths or the 64 MiB total inspection limit; no repair or overwrite was attempted." } :
        modified ? { suggestion:
          "Review these user edits before upgrading this feature. Do not overwrite them or silently reset the recorded digests." } : {}),
    });
  }
  if (capabilities.length === 0) diagnostics.push({
    id: "project.capability-files", status: "pass", message: "No capability files are recorded; zero source files checked.",
  });
  const healthy = !diagnostics.some(check => check.status === "fail");
  return {
    schemaVersion: 1, root: boundary.projectRoot, solution: { ...state.solution }, healthy,
    clean: healthy && capabilities.every(capability => capability.files.every(file => file.status === "unchanged")),
    capabilities, diagnostics,
  };
}
