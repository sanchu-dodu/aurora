import { AuroraError } from "../errors/AuroraError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import { ProjectPathBoundary } from "../security/projectPathBoundary.js";
import { ProjectLifecycleLock } from "../packages/lifecycle/projectLifecycleLock.js";
import { listOperationJournals } from "./operationJournal.js";
import { previewOperationRecovery, recoverOperationTransaction } from "./durableOperationTransaction.js";
import { assertLifecycleJournalsCommitted } from "./operationPlanService.js";

const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface RecoverOperationOptions {
  readonly approved: boolean;
  readonly dryRun?: boolean;
}

/** Explicit, silent recovery for file plans. Never runs package or project code. */
export class OperationRecoveryService {
  async list(projectRoot: string) {
    const boundary = new ProjectPathBoundary(projectRoot);
    try {
      const transactions = (await listOperationJournals(boundary.projectRoot))
        .filter(journal => journal.phase !== "committed");
      return { schemaVersion: 1 as const, root: boundary.projectRoot, transactions };
    } catch (error) {
      throw recoveryError("Operation-plan recovery metadata cannot be safely inspected.", error);
    }
  }

  async recover(transactionId: string, projectRoot: string, options: RecoverOperationOptions) {
    if (!TRANSACTION_ID.test(transactionId) || typeof options.approved !== "boolean" ||
        (options.dryRun !== undefined && typeof options.dryRun !== "boolean")) {
      throw recoveryError("Invalid operation-plan recovery selector or options.");
    }
    if (!options.approved && !options.dryRun) {
      throw new AuroraError("Explicit approval is required before operation-plan recovery.", {
        code: ErrorCodes.OPERATION_APPROVAL_REQUIRED,
        suggestion: "Inspect with --dry-run, then use --yes only after reviewing the selected transaction.",
      });
    }
    const boundary = new ProjectPathBoundary(projectRoot);
    if (options.dryRun) {
      try {
        await assertLifecycleJournalsCommitted(boundary);
        const journal = await previewOperationRecovery(boundary.projectRoot, transactionId);
        return { schemaVersion: 1 as const, root: boundary.projectRoot,
          transactionId: journal.transactionId, planId: journal.planId, status: "dry-run" as const };
      } catch (error) {
        if (error instanceof AuroraError) throw error;
        throw recoveryError("Operation-plan recovery preview could not be validated; no recovery was performed.", error);
      }
    }
    let lock: ProjectLifecycleLock;
    try {
      lock = await ProjectLifecycleLock.acquire(boundary.projectRoot, { allowOperationRecovery: true });
    } catch (error) {
      throw recoveryError("Operation-plan recovery could not acquire the project lifecycle lock.", error);
    }
    let failed = false;
    let failure: unknown;
    try {
      await assertLifecycleJournalsCommitted(boundary);
      const journal = await recoverOperationTransaction(boundary.projectRoot, transactionId, lock);
      return { schemaVersion: 1 as const, root: boundary.projectRoot,
        transactionId: journal.transactionId, planId: journal.planId, status: "recovered" as const };
    } catch (error) {
      failed = true;
      failure = error;
      if (error instanceof AuroraError) throw error;
      throw recoveryError("Operation-plan recovery did not finish; inspect its retained recovery record before retrying.", error);
    } finally {
      try { await lock.release(); }
      catch (error) {
        throw recoveryError("Operation-plan recovery could not release its lifecycle lock.",
          failed ? new AggregateError([failure, error]) : error);
      }
    }
  }
}

function recoveryError(message: string, cause?: unknown): AuroraError {
  return new AuroraError(message, { code: ErrorCodes.INVALID_OPERATION_PLAN,
    suggestion: "Review the selected plan journal and any package recovery records. Do not delete recovery evidence or reset user edits.", cause });
}
