import {
  createHash,
} from "node:crypto";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import type {
  CredentialStore,
} from "../../security/credentials/credentialStore.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

const PACKAGE_SECRET_CREDENTIAL_DOMAIN =
  "AURORA-PACKAGE-SECRET-CREDENTIAL-V1";

const PACKAGE_SECRET_COMPONENT_PATTERN =
  /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

const PACKAGE_SECRET_COMPONENT_MAX_LENGTH =
  128;

export type PackageSecretIdentity =
  Readonly<
    Pick<
      PackageManifest,
      "id" | "publisher"
    >
  >;

export type PackageSecretManifest =
  Readonly<
    Pick<
      PackageManifest,
      | "id"
      | "publisher"
      | "capabilities"
      | "secrets"
    >
  >;

export interface PackageSecretReader {
  readSecret(
    manifest: PackageSecretManifest,
    secretName: string
  ): Promise<string | null>;
}

export class PackageSecretBroker
implements PackageSecretReader {
  constructor(
    private readonly credentialStore:
      CredentialStore
  ) {}

  async readSecret(
    manifest: PackageSecretManifest,
    secretName: string
  ): Promise<string | null> {
    /*
     * Validate namespace components before touching
     * the operating-system credential store.
     */
    const credentialId =
      derivePackageSecretCredentialId(
        manifest,
        secretName
      );

    /*
     * Defense in depth: manifest validation and the
     * execution capability policy are not the only
     * authorization boundaries.
     *
     * The secret broker itself requires both the
     * host.secrets.read capability declaration and
     * the exact requested secret declaration.
     */
    const declaration =
      assertManifestAuthorizesSecret(
        manifest,
        secretName
      );

    const secret =
      await this.credentialStore.get(
        credentialId,
        {
          scope: "local",
          purpose:
            "package-secret-read",
        }
      );

    if (
      secret === null &&
      declaration.required
    ) {
      throw requiredSecretError(
        manifest.id,
        secretName
      );
    }

    return secret;
  }
}

export function derivePackageSecretCredentialId(
  identity: PackageSecretIdentity,
  secretName: string
): string {
  assertCanonicalComponent(
    "publisher",
    identity.publisher.id
  );

  assertCanonicalComponent(
    "package",
    identity.id
  );

  assertCanonicalComponent(
    "secret",
    secretName
  );

  const digest =
    createHash("sha256")
      .update(
        PACKAGE_SECRET_CREDENTIAL_DOMAIN,
        "utf8"
      )
      .update("\0")
      .update(
        identity.publisher.id,
        "utf8"
      )
      .update("\0")
      .update(
        identity.id,
        "utf8"
      )
      .update("\0")
      .update(
        secretName,
        "utf8"
      )
      .digest("hex");

  return `package-secret.${digest}`;
}

function assertManifestAuthorizesSecret(
  manifest: PackageSecretManifest,
  secretName: string
): Readonly<{
  name: string;
  required: boolean;
}> {
  if (
    !manifest.capabilities.includes(
      "host.secrets.read"
    )
  ) {
    throw permissionError(
      manifest.id,
      secretName,
      "does not declare host.secrets.read"
    );
  }

  const declaration =
    (manifest.secrets ?? [])
      .find(
        candidate =>
          candidate.name ===
          secretName
      );

  if (!declaration) {
    throw permissionError(
      manifest.id,
      secretName,
      "does not explicitly declare that package secret"
    );
  }

  return declaration;
}

function assertCanonicalComponent(
  label: string,
  value: string
): void {
  if (
    value.length === 0 ||
    value.length >
      PACKAGE_SECRET_COMPONENT_MAX_LENGTH ||
    !PACKAGE_SECRET_COMPONENT_PATTERN.test(
      value
    )
  ) {
    throw new AuroraError(
      `Package secret ${label} identifier is invalid.`,
      {
        code:
          ErrorCodes
            .PACKAGE_PERMISSION_DENIED,
        suggestion:
          "Use canonical lowercase package-secret identifiers and request only secrets within the package-scoped broker.",
      }
    );
  }
}

function requiredSecretError(
  packageId: string,
  secretName: string
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' requires package secret '${secretName}', but no value is available.`,
    {
      code:
        ErrorCodes
          .PACKAGE_SECRET_REQUIRED,
      suggestion:
        "Store the required package-scoped secret in the Aurora credential store before running the package.",
    }
  );
}
function permissionError(
  packageId: string,
  secretName: string,
  reason: string
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' cannot read package secret '${secretName}': ${reason}.`,
    {
      code:
        ErrorCodes
          .PACKAGE_PERMISSION_DENIED,
      suggestion:
        "Declare the exact package secret in Manifest v1 and explicitly grant host.secrets.read through the host execution policy.",
    }
  );
}
