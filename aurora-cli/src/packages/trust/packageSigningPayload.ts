import {
  canonicalizeJson,
} from "./packageCanonicalJson.js";

export const PACKAGE_SIGNING_DOMAIN =
  "AURORA-PACKAGE-MANIFEST-SIGNATURE-V1" as const;

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

export function createPackageSigningDocument(
  manifest: unknown
): Record<string, unknown> {
  assertPlainObject(
    manifest,
    "Package manifest"
  );

  if (
    Object.getOwnPropertySymbols(
      manifest
    ).length > 0
  ) {
    throw new TypeError(
      "Package manifest cannot contain symbol properties."
    );
  }

  const document:
    Record<string, unknown> =
      Object.create(null) as
        Record<string, unknown>;

  for (
    const key
    of Object.getOwnPropertyNames(
      manifest
    )
  ) {
    const value =
      readSafeDataProperty(
        manifest,
        key,
        "Package manifest"
      );

    if (key !== "signature") {
      document[key] =
        value;

      continue;
    }

    assertPlainObject(
      value,
      "Package manifest signature"
    );

    if (
      Object.getOwnPropertySymbols(
        value
      ).length > 0
    ) {
      throw new TypeError(
        "Package manifest signature cannot contain symbol properties."
      );
    }

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
          "Package manifest signature"
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

export function createPackageSigningPayload(
  manifest: unknown
): Buffer {
  const signingDocument =
    createPackageSigningDocument(
      manifest
    );

  const canonicalManifest =
    canonicalizeJson(
      signingDocument
    );

  const domain =
    Buffer.from(
      `${PACKAGE_SIGNING_DOMAIN}\0`,
      "utf8"
    );

  const payload =
    Buffer.from(
      canonicalManifest,
      "utf8"
    );

  return Buffer.concat([
    domain,
    payload,
  ]);
}