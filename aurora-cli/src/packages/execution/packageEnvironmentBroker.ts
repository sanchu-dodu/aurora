import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

export const PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES =
  64 * 1024;

const ENVIRONMENT_NAME_PATTERN =
  /^[A-Z][A-Z0-9_]*$/u;

const ENVIRONMENT_NAME_MAX_LENGTH =
  128;

export type PackageEnvironmentIdentity =
  Readonly<
    Pick<
      PackageManifest,
      "id" | "publisher"
    >
  >;

export type PackageEnvironmentManifest =
  Readonly<
    Pick<
      PackageManifest,
      | "id"
      | "publisher"
      | "capabilities"
      | "hostEnvironment"
    >
  >;

export interface PackageEnvironmentValueProvider {
  readEnvironmentValue(
    identity: PackageEnvironmentIdentity,
    variableName: string
  ): Promise<string | null>;
}

export interface PackageEnvironmentReader {
  readEnvironmentVariable(
    manifest: PackageEnvironmentManifest,
    variableName: string
  ): Promise<string | null>;
}

export class PackageEnvironmentBroker
implements PackageEnvironmentReader {
  constructor(
    private readonly provider:
      PackageEnvironmentValueProvider
  ) {}

  async readEnvironmentVariable(
    manifest: PackageEnvironmentManifest,
    variableName: string
  ): Promise<string | null> {
    assertCanonicalEnvironmentName(
      variableName
    );

    const declaration =
      assertManifestAuthorizesEnvironment(
        manifest,
        variableName
      );

    const value =
      await this.provider
        .readEnvironmentValue(
          manifest,
          variableName
        );

    if (value === null) {
      if (declaration.required) {
        throw requiredEnvironmentError(
          manifest.id,
          variableName
        );
      }

      return null;
    }

    if (typeof value !== "string") {
      throw invalidProviderValueError(
        manifest.id,
        variableName,
        "returned a non-string value"
      );
    }

    if (value.includes("\0")) {
      throw invalidProviderValueError(
        manifest.id,
        variableName,
        "returned a value containing a NUL character"
      );
    }

    const byteLength =
      Buffer.byteLength(
        value,
        "utf8"
      );

    if (
      byteLength >
      PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES
    ) {
      throw invalidProviderValueError(
        manifest.id,
        variableName,
        `returned ${byteLength} bytes, exceeding the ${PACKAGE_ENVIRONMENT_VALUE_MAX_BYTES} byte limit`
      );
    }

    return value;
  }
}

function assertManifestAuthorizesEnvironment(
  manifest: PackageEnvironmentManifest,
  variableName: string
): Readonly<{
  name: string;
  required: boolean;
}> {
  if (
    !manifest.capabilities.includes(
      "host.environment.read"
    )
  ) {
    throw permissionError(
      manifest.id,
      variableName,
      "does not declare host.environment.read"
    );
  }

  const declaration =
    (manifest.hostEnvironment ?? [])
      .find(
        candidate =>
          candidate.name ===
          variableName
      );

  if (!declaration) {
    throw permissionError(
      manifest.id,
      variableName,
      "does not explicitly declare that host environment variable"
    );
  }

  return declaration;
}

function assertCanonicalEnvironmentName(
  variableName: string
): void {
  if (
    variableName.length === 0 ||
    variableName.length >
      ENVIRONMENT_NAME_MAX_LENGTH ||
    !ENVIRONMENT_NAME_PATTERN.test(
      variableName
    )
  ) {
    throw new AuroraError(
      "Package host environment variable name is invalid.",
      {
        code:
          ErrorCodes
            .PACKAGE_PERMISSION_DENIED,
        suggestion:
          "Request only canonical host environment names explicitly declared by the package.",
      }
    );
  }
}

function requiredEnvironmentError(
  packageId: string,
  variableName: string
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' requires host environment variable '${variableName}', but no value is available.`,
    {
      code:
        ErrorCodes
          .PACKAGE_ENVIRONMENT_REQUIRED,
      suggestion:
        "Provide the required non-secret host environment value through Aurora's trusted host environment provider.",
    }
  );
}

function invalidProviderValueError(
  packageId: string,
  variableName: string,
  reason: string
): AuroraError {
  return new AuroraError(
    `Host environment provider for package '${packageId}' variable '${variableName}' ${reason}.`,
    {
      code:
        ErrorCodes
          .PACKAGE_EXECUTION_FAILED,
      suggestion:
        "Provide a valid non-secret UTF-8 string no larger than the package host-environment value limit.",
    }
  );
}

function permissionError(
  packageId: string,
  variableName: string,
  reason: string
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' cannot read host environment variable '${variableName}': ${reason}.`,
    {
      code:
        ErrorCodes
          .PACKAGE_PERMISSION_DENIED,
      suggestion:
        "Declare the exact non-secret host environment variable in Manifest v1 and grant it through trusted package-scoped host policy.",
    }
  );
}
