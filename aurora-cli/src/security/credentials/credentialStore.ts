import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  FileSecretAccessAuditLog,
  type SecretAccessAuditLog,
  type SecretAccessContext,
  type SecretAuditAction,
  type SecretAuditOutcome,
} from "./secretAccessAuditLog.js";

const CREDENTIAL_ID_PATTERN =
  /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

const KEYRING_MODULE =
  "@napi-rs/keyring";

interface KeyringEntry {
  setPassword(
    password: string
  ): Promise<void>;

  getPassword():
    Promise<string | undefined>;

  deleteCredential():
    Promise<boolean>;
}

export type KeyringEntryFactory =
  (
    service: string,
    credentialId: string
  ) => Promise<KeyringEntry>;

export interface CredentialStoreOptions {
  readonly service?: string;

  readonly entryFactory?:
    KeyringEntryFactory;

  readonly auditLog?:
    SecretAccessAuditLog;
}

export interface CredentialStore {
  set(
    credentialId: string,
    secret: string,
    context?: SecretAccessContext
  ): Promise<void>;

  get(
    credentialId: string,
    context?: SecretAccessContext
  ): Promise<string | null>;

  delete(
    credentialId: string,
    context?: SecretAccessContext
  ): Promise<boolean>;
}

export class OsCredentialStore
implements CredentialStore {
  private readonly service:
    string;

  private readonly entryFactory:
    KeyringEntryFactory;

  private readonly auditLog:
    SecretAccessAuditLog;

  constructor(
    options:
      CredentialStoreOptions = {}
  ) {
    this.service =
      options.service ??
      "Aurora CLI";

    this.entryFactory =
      options.entryFactory ??
      createNativeEntry;

    this.auditLog =
      options.auditLog ??
      new FileSecretAccessAuditLog();
  }

  async set(
    credentialId: string,
    secret: string,
    context: SecretAccessContext = {}
  ): Promise<void> {
    validateCredentialId(
      credentialId
    );

    validateAccessContext(context);

    if (
      !secret ||
      secret.includes("\0")
    ) {
      throw credentialError(
        "Credential values must be non-empty strings without NUL characters."
      );
    }

    try {
      const entry =
        await this.entryFactory(
          this.service,
          credentialId
        );

      await entry.setPassword(
        secret
      );

      await this.audit(
        "write",
        credentialId,
        "success",
        context
      );
    } catch (error) {
      await this.auditFailure(
        "write",
        credentialId,
        context
      );

      if (
        error instanceof AuroraError
      ) {
        throw error;
      }

      throw credentialError(
        `Credential '${credentialId}' could not be stored in the operating system credential store.`,
        error
      );
    }
  }

  async get(
    credentialId: string,
    context: SecretAccessContext = {}
  ): Promise<string | null> {
    validateCredentialId(
      credentialId
    );

    validateAccessContext(context);

    try {
      const entry =
        await this.entryFactory(
          this.service,
          credentialId
        );

      const secret =
        await entry.getPassword();

      await this.audit(
        "read",
        credentialId,
        secret === undefined
          ? "not_found"
          : "success",
        context
      );

      return secret ?? null;
    } catch (error) {
      await this.auditFailure(
        "read",
        credentialId,
        context
      );

      if (
        error instanceof AuroraError
      ) {
        throw error;
      }

      throw credentialError(
        `Credential '${credentialId}' could not be read from the operating system credential store.`,
        error
      );
    }
  }

  async delete(
    credentialId: string,
    context: SecretAccessContext = {}
  ): Promise<boolean> {
    validateCredentialId(
      credentialId
    );

    validateAccessContext(context);

    try {
      const entry =
        await this.entryFactory(
          this.service,
          credentialId
        );

      const deleted =
        await entry.deleteCredential();

      await this.audit(
        "delete",
        credentialId,
        deleted
          ? "success"
          : "not_found",
        context
      );

      return deleted;
    } catch (error) {
      await this.auditFailure(
        "delete",
        credentialId,
        context
      );

      if (
        error instanceof AuroraError
      ) {
        throw error;
      }

      throw credentialError(
        `Credential '${credentialId}' could not be deleted from the operating system credential store.`,
        error
      );
    }
  }

  private async audit(
    action: SecretAuditAction,
    credentialId: string,
    outcome: SecretAuditOutcome,
    context: SecretAccessContext
  ): Promise<void> {
    await this.auditLog.record({
      action,
      credentialId,
      outcome,
      ...context,
    });
  }

  private async auditFailure(
    action: SecretAuditAction,
    credentialId: string,
    context: SecretAccessContext
  ): Promise<void> {
    try {
      await this.audit(
        action,
        credentialId,
        "error",
        context
      );
    } catch (auditError) {
      if (
        auditError instanceof
          AuroraError
      ) {
        throw auditError;
      }

      throw new AuroraError(
        "Aurora could not record a failed credential operation.",
        {
          code:
            ErrorCodes
              .SECRET_AUDIT_FAILED,
          suggestion:
            "Repair the per-user Aurora audit directory before accessing credentials.",
          cause: auditError,
        }
      );
    }
  }
}

async function createNativeEntry(
  service: string,
  credentialId: string
): Promise<KeyringEntry> {
  const keyring =
    await import(
      KEYRING_MODULE
    ) as {
      AsyncEntry: new (
        serviceName: string,
        username: string
      ) => KeyringEntry;
    };

  return new keyring.AsyncEntry(
    service,
    credentialId
  );
}

function validateCredentialId(
  credentialId: string
): void {
  if (
    credentialId.length > 128 ||
    !CREDENTIAL_ID_PATTERN.test(
      credentialId
    )
  ) {
    throw credentialError(
      `Invalid credential identifier '${credentialId}'.`
    );
  }
}

function validateAccessContext(
  context: SecretAccessContext
): void {
  for (
    const [label, value]
    of [
      [
        "organizationId",
        context.organizationId,
      ],
      [
        "purpose",
        context.purpose,
      ],
    ] as const
  ) {
    if (
      value !== undefined &&
      (
        value.length > 128 ||
        !CREDENTIAL_ID_PATTERN.test(
          value
        )
      )
    ) {
      throw credentialError(
        `Credential access ${label} must be a canonical identifier.`
      );
    }
  }

  if (
    context.scope ===
      "organization" &&
    (
      !context.organizationId ||
      !context.purpose
    )
  ) {
    throw credentialError(
      "Organization credential access requires canonical organizationId and purpose metadata."
    );
  }
}

function credentialError(
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    message,
    {
      code:
        ErrorCodes
          .CREDENTIAL_STORE_FAILED,
      suggestion:
        "Use a canonical credential identifier and ensure the operating system credential service is available.",
      cause,
    }
  );
}
