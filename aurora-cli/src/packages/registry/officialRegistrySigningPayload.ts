import {
  createHash,
} from "node:crypto";

import {
  canonicalizeJson,
} from "../trust/packageCanonicalJson.js";

export const OFFICIAL_REGISTRY_SIGNING_DOMAIN =
  "AURORA-OFFICIAL-PACKAGE-REGISTRY-SIGNATURE-V1" as const;

export const OFFICIAL_REGISTRY_SNAPSHOT_DIGEST_DOMAIN =
  "AURORA-OFFICIAL-PACKAGE-REGISTRY-SNAPSHOT-DIGEST-V1" as const;

function assertPlainObject(
  value: unknown,
  name: string
): asserts value is
  Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${name} must be a plain JSON object.`
    );
  }

  const prototype =
    Object.getPrototypeOf(value);

  if (
    prototype !==
      Object.prototype &&
    prototype !== null
  ) {
    throw new TypeError(
      `${name} must use Object.prototype or a null prototype.`
    );
  }
}

function readSafeDataProperty(
  value: object,
  key: string,
  name: string
): unknown {
  const descriptor =
    Object.getOwnPropertyDescriptor(
      value,
      key
    );

  if (!descriptor) {
    return undefined;
  }

  if (
    !descriptor.enumerable ||
    !("value" in descriptor)
  ) {
    throw new TypeError(
      `${name}.${key} must be an enumerable data property.`
    );
  }

  return descriptor.value;
}

function assertNoSymbolProperties(
  value: object,
  name: string
): void {
  if (
    Object.getOwnPropertySymbols(
      value
    ).length > 0
  ) {
    throw new TypeError(
      `${name} cannot contain symbol properties.`
    );
  }
}

export function createOfficialRegistrySigningDocument(
  snapshot: unknown
): Record<string, unknown> {
  assertPlainObject(
    snapshot,
    "Official registry snapshot"
  );

  assertNoSymbolProperties(
    snapshot,
    "Official registry snapshot"
  );

  const document:
    Record<string, unknown> =
      Object.create(null) as
        Record<string, unknown>;

  for (
    const key
    of Object.getOwnPropertyNames(
      snapshot
    )
  ) {
    const value =
      readSafeDataProperty(
        snapshot,
        key,
        "Official registry snapshot"
      );

    if (key !== "signature") {
      document[key] =
        value;

      continue;
    }

    assertPlainObject(
      value,
      "Official registry snapshot signature"
    );

    assertNoSymbolProperties(
      value,
      "Official registry snapshot signature"
    );

    const signature:
      Record<string, unknown> =
        Object.create(null) as
          Record<string, unknown>;

    for (
      const signatureKey
      of Object.getOwnPropertyNames(
        value
      )
    ) {
      const signatureValue =
        readSafeDataProperty(
          value,
          signatureKey,
          "Official registry snapshot signature"
        );

      if (
        signatureKey ===
        "value"
      ) {
        continue;
      }

      signature[
        signatureKey
      ] =
        signatureValue;
    }

    document.signature =
      signature;
  }

  return document;
}

function domainSeparatedPayload(
  domain: string,
  canonicalDocument: string
): Buffer {
  return Buffer.concat([
    Buffer.from(
      `${domain}\0`,
      "utf8"
    ),
    Buffer.from(
      canonicalDocument,
      "utf8"
    ),
  ]);
}

export function createOfficialRegistrySigningPayload(
  snapshot: unknown
): Buffer {
  const signingDocument =
    createOfficialRegistrySigningDocument(
      snapshot
    );

  const canonicalDocument =
    canonicalizeJson(
      signingDocument
    );

  return domainSeparatedPayload(
    OFFICIAL_REGISTRY_SIGNING_DOMAIN,
    canonicalDocument
  );
}

/*
 * Snapshot chaining binds the complete signed snapshot,
 * including signature.value. This means a successor names
 * the exact previously verified registry document rather
 * than only its unsigned metadata.
 */
export function calculateOfficialRegistrySnapshotDigest(
  snapshot: unknown
): string {
  const canonicalSnapshot =
    canonicalizeJson(
      snapshot
    );

  const payload =
    domainSeparatedPayload(
      OFFICIAL_REGISTRY_SNAPSHOT_DIGEST_DOMAIN,
      canonicalSnapshot
    );

  return createHash(
    "sha256"
  )
    .update(payload)
    .digest("hex");
}