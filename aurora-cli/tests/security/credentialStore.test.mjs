import test from "node:test";
import assert from "node:assert/strict";

import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  OsCredentialStore,
} from "../../dist/security/credentials/credentialStore.js";

import {
  FileSecretAccessAuditLog,
} from "../../dist/security/credentials/secretAccessAuditLog.js";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

function createMemoryKeyring() {
  const values = new Map();

  return {
    values,
    entryFactory:
      async (
        service,
        credentialId
      ) => ({
        async setPassword(secret) {
          values.set(
            `${service}:${credentialId}`,
            secret
          );
        },
        async getPassword() {
          return values.get(
            `${service}:${credentialId}`
          );
        },
        async deleteCredential() {
          return values.delete(
            `${service}:${credentialId}`
          );
        },
      }),
  };
}

test(
  "OS credential abstraction stores secrets outside configuration and audits metadata only",
  async () => {
    const keyring =
      createMemoryKeyring();
    const events = [];
    const secret =
      "credential-value-never-audited";

    const store =
      new OsCredentialStore({
        service: "Aurora Tests",
        entryFactory:
          keyring.entryFactory,
        auditLog: {
          async record(event) {
            events.push({
              ...event,
            });
          },
        },
      });

    await store.set(
      "cloud-token",
      secret,
      {
        scope: "organization",
        organizationId:
          "example-org",
        purpose:
          "deployment-read",
      }
    );

    assert.equal(
      await store.get(
        "cloud-token",
        {
          scope: "organization",
          organizationId:
            "example-org",
          purpose:
            "deployment-read",
        }
      ),
      secret
    );

    assert.equal(
      await store.delete(
        "cloud-token",
        {
          scope: "organization",
          organizationId:
            "example-org",
          purpose:
            "deployment-delete",
        }
      ),
      true
    );

    assert.deepEqual(
      events.map(
        event => [
          event.action,
          event.outcome,
        ]
      ),
      [
        [
          "write",
          "success",
        ],
        [
          "read",
          "success",
        ],
        [
          "delete",
          "success",
        ],
      ]
    );

    assert.equal(
      JSON.stringify(events)
        .includes(secret),
      false
    );
  }
);

test(
  "credential identifiers and organization audit context are fail-closed",
  async () => {
    const keyring =
      createMemoryKeyring();
    const store =
      new OsCredentialStore({
        entryFactory:
          keyring.entryFactory,
        auditLog: {
          async record() {},
        },
      });

    await assert.rejects(
      store.set(
        "../unsafe",
        "secret"
      ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .CREDENTIAL_STORE_FAILED
        );
        return true;
      }
    );

    await assert.rejects(
      store.get(
        "valid-id",
        {
          scope: "organization",
          organizationId:
            "example-org",
        }
      ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .CREDENTIAL_STORE_FAILED
        );
        return true;
      }
    );

    await assert.rejects(
      store.get(
        "valid-id",
        {
          scope: "local",
          purpose:
            "contains a space",
        }
      ),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .CREDENTIAL_STORE_FAILED
        );
        return true;
      }
    );
  }
);

test(
  "credential operations fail when their audit record cannot be written",
  async () => {
    const keyring =
      createMemoryKeyring();
    const store =
      new OsCredentialStore({
        entryFactory:
          keyring.entryFactory,
        auditLog: {
          async record() {
            throw new Error(
              "audit unavailable"
            );
          },
        },
      });

    await assert.rejects(
      store.get("missing-id"),
      error => {
        assert.equal(
          error.code,
          ErrorCodes
            .SECRET_AUDIT_FAILED
        );
        return true;
      }
    );
  }
);

test(
  "file audit log records durable metadata without credential values",
  async () => {
    const stateRoot = await mkdtemp(
      join(
        tmpdir(),
        "aurora-secret-audit-"
      )
    );
    const secret =
      "not-present-in-audit";

    try {
      const auditLog =
        new FileSecretAccessAuditLog({
          stateRoot,
          actor: "test-user",
          now: () =>
            new Date(
              "2026-08-13T10:00:00.000Z"
            ),
        });

      await auditLog.record({
        action: "read",
        credentialId:
          "deployment-token",
        outcome: "success",
        scope: "organization",
        organizationId:
          "example-org",
        purpose:
          "deployment-read",
      });

      const raw = await readFile(
        join(
          stateRoot,
          "secret-access.jsonl"
        ),
        "utf8"
      );
      const record =
        JSON.parse(raw.trim());

      assert.deepEqual(record, {
        schemaVersion: 1,
        timestamp:
          "2026-08-13T10:00:00.000Z",
        actor: "test-user",
        action: "read",
        credentialId:
          "deployment-token",
        outcome: "success",
        scope: "organization",
        organizationId:
          "example-org",
        purpose:
          "deployment-read",
      });
      assert.equal(
        raw.includes(secret),
        false
      );
      assert.equal(
        "secret" in record,
        false
      );
    } finally {
      await rm(
        stateRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
