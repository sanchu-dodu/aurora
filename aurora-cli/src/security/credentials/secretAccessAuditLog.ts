import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../projectPathBoundary.js";

export type SecretAuditAction =
  | "delete"
  | "read"
  | "write";

export type SecretAuditOutcome =
  | "error"
  | "not_found"
  | "success";

export interface SecretAccessContext {
  readonly scope?:
    | "local"
    | "organization";

  readonly organizationId?:
    string;

  readonly purpose?: string;
}

export interface SecretAuditEvent
extends SecretAccessContext {
  readonly action:
    SecretAuditAction;

  readonly credentialId: string;

  readonly outcome:
    SecretAuditOutcome;
}

export interface SecretAccessAuditLog {
  record(
    event: SecretAuditEvent
  ): Promise<void>;
}

export interface FileSecretAccessAuditLogOptions {
  readonly stateRoot?: string;

  readonly now?: () => Date;

  readonly actor?: string;
}

export class FileSecretAccessAuditLog
implements SecretAccessAuditLog {
  private readonly stateRoot:
    string;

  private readonly now:
    () => Date;

  private readonly actor:
    string;

  constructor(
    options:
      FileSecretAccessAuditLogOptions = {}
  ) {
    this.stateRoot =
      options.stateRoot ??
      getDefaultStateRoot();

    this.now =
      options.now ??
      (() => new Date());

    this.actor =
      options.actor ??
      os.userInfo().username;
  }

  async record(
    event: SecretAuditEvent
  ): Promise<void> {
    try {
      await fs.mkdir(
        this.stateRoot,
        {
          recursive: true,
          mode: 0o700,
        }
      );

      const rootInformation =
        await fs.lstat(
          this.stateRoot
        );

      if (
        !rootInformation.isDirectory() ||
        rootInformation.isSymbolicLink()
      ) {
        throw new Error(
          "The Aurora state root is not a regular directory."
        );
      }

      const boundary =
        new ProjectPathBoundary(
          this.stateRoot
        );

      const auditFile =
        boundary.resolve(
          "secret-access.jsonl"
        );

      const record = {
        schemaVersion: 1,
        timestamp:
          this.now().toISOString(),
        actor: this.actor,
        action: event.action,
        credentialId:
          event.credentialId,
        outcome: event.outcome,
        scope:
          event.scope ?? "local",
        ...(event.organizationId
          ? {
              organizationId:
                event.organizationId,
            }
          : {}),
        ...(event.purpose
          ? {
              purpose:
                event.purpose,
            }
          : {}),
      };

      const handle =
        await fs.open(
          auditFile,
          "a",
          0o600
        );

      try {
        await handle.appendFile(
          `${JSON.stringify(record)}\n`,
          "utf8"
        );

        await handle.sync();
      } finally {
        await handle.close();
      }

      await fs.chmod(
        auditFile,
        0o600
      );
    } catch (error) {
      if (
        error instanceof AuroraError &&
        error.code ===
          ErrorCodes
            .SECRET_AUDIT_FAILED
      ) {
        throw error;
      }

      throw new AuroraError(
        "Aurora could not record the credential access audit event.",
        {
          code:
            ErrorCodes
              .SECRET_AUDIT_FAILED,
          suggestion:
            "Confirm the per-user Aurora state directory is private and writable.",
          cause: error,
        }
      );
    }
  }
}

export function getDefaultStateRoot():
  string {
  if (
    process.platform === "win32"
  ) {
    const localAppData =
      process.env.LOCALAPPDATA;

    if (localAppData) {
      return path.join(
        localAppData,
        "Aurora"
      );
    }
  }

  if (
    process.platform === "darwin"
  ) {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Aurora"
    );
  }

  const stateHome =
    process.env.XDG_STATE_HOME;

  return stateHome
    ? path.join(
        stateHome,
        "aurora"
      )
    : path.join(
        os.homedir(),
        ".local",
        "state",
        "aurora"
      );
}
