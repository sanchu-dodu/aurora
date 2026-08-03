import {
  readFileSync,
} from "node:fs";

export interface AuroraCliMetadata {
  readonly name: string;

  readonly version: string;

  readonly description: string;
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function readRequiredString(
  source: Record<string, unknown>,
  field: string
): string {
  const value =
    source[field];

  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(
      `Aurora package metadata field '${field}' must be a non-empty string.`
    );
  }

  return value;
}

function loadPackageMetadata():
  AuroraCliMetadata {
  const packageJsonUrl =
    new URL(
      "../../package.json",
      import.meta.url
    );

  const parsed: unknown =
    JSON.parse(
      readFileSync(
        packageJsonUrl,
        "utf8"
      )
    );

  if (!isRecord(parsed)) {
    throw new Error(
      "Aurora package metadata must be a JSON object."
    );
  }

  return Object.freeze({
    name:
      readRequiredString(
        parsed,
        "name"
      ),

    version:
      readRequiredString(
        parsed,
        "version"
      ),

    description:
      readRequiredString(
        parsed,
        "description"
      ),
  });
}

export const AURORA_CLI_METADATA =
  loadPackageMetadata();

export const AURORA_CLI_VERSION =
  AURORA_CLI_METADATA.version;