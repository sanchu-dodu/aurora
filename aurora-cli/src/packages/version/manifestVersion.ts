const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export interface ManifestSemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

interface VersionComparator {
  readonly operator:
    | "="
    | ">"
    | ">="
    | "<"
    | "<="
    | "^"
    | "~";

  readonly version:
    ManifestSemVer;
}

export function parseManifestSemVer(
  version: string
): ManifestSemVer {
  const match =
    SEMVER_PATTERN.exec(version);

  if (!match) {
    throw new Error(
      `Invalid semantic version '${version}'.`
    );
  }

  const numericParts = [
    match[1],
    match[2],
    match[3],
  ].map(Number);

  if (
    numericParts.some(
      (part) =>
        !Number.isSafeInteger(part)
    )
  ) {
    throw new Error(
      `Semantic version '${version}' exceeds JavaScript's safe integer range.`
    );
  }

  return {
    major: numericParts[0],
    minor: numericParts[1],
    patch: numericParts[2],
    prerelease:
      match[4]?.split(".") ?? [],
  };
}

export function isManifestSemVer(
  version: string
): boolean {
  try {
    parseManifestSemVer(version);
    return true;
  } catch {
    return false;
  }
}

export function compareManifestSemVer(
  left: ManifestSemVer,
  right: ManifestSemVer
): number {
  for (const key of [
    "major",
    "minor",
    "patch",
  ] as const) {
    const difference =
      left[key] - right[key];

    if (difference !== 0) {
      return difference;
    }
  }

  if (
    left.prerelease.length === 0 &&
    right.prerelease.length === 0
  ) {
    return 0;
  }

  if (left.prerelease.length === 0) {
    return 1;
  }

  if (right.prerelease.length === 0) {
    return -1;
  }

  const length = Math.max(
    left.prerelease.length,
    right.prerelease.length
  );

  for (let index = 0; index < length; index += 1) {
    const leftIdentifier =
      left.prerelease[index];

    const rightIdentifier =
      right.prerelease[index];

    if (leftIdentifier === undefined) {
      return -1;
    }

    if (rightIdentifier === undefined) {
      return 1;
    }

    if (leftIdentifier === rightIdentifier) {
      continue;
    }

    const leftIsNumeric =
      /^\d+$/.test(leftIdentifier);

    const rightIsNumeric =
      /^\d+$/.test(rightIdentifier);

    if (
      leftIsNumeric &&
      rightIsNumeric
    ) {
      if (
        leftIdentifier.length !==
        rightIdentifier.length
      ) {
        return leftIdentifier.length -
          rightIdentifier.length;
      }

      return leftIdentifier <
        rightIdentifier
        ? -1
        : 1;
    }

    if (leftIsNumeric) {
      return -1;
    }

    if (rightIsNumeric) {
      return 1;
    }

    return leftIdentifier <
      rightIdentifier
      ? -1
      : 1;
  }

  return 0;
}

function parseComparator(
  token: string
): VersionComparator {
  const match =
    /^(>=|<=|>|<|\^|~|=)?(.+)$/.exec(
      token
    );

  if (!match) {
    throw new Error(
      `Invalid version comparator '${token}'.`
    );
  }

  return {
    operator:
      (match[1] ?? "=") as
        VersionComparator["operator"],
    version:
      parseManifestSemVer(match[2]),
  };
}

function parseRange(
  range: string
): VersionComparator[] {
  const normalized = range.trim();

  if (!normalized) {
    throw new Error(
      "Version range cannot be empty."
    );
  }

  if (
    normalized !== range ||
    /\s{2,}|[\t\r\n]/.test(range)
  ) {
    throw new Error(
      "Version ranges must use canonical single-space comparator separation."
    );
  }

  if (normalized.includes("||")) {
    throw new Error(
      "Disjunctive version ranges are not supported in Manifest v1."
    );
  }

  return normalized
    .split(/\s+/)
    .map(parseComparator);
}

export function isManifestVersionRange(
  range: string
): boolean {
  try {
    parseRange(range);
    return true;
  } catch {
    return false;
  }
}

function satisfiesComparator(
  version: ManifestSemVer,
  comparator: VersionComparator
): boolean {
  const comparison =
    compareManifestSemVer(
      version,
      comparator.version
    );

  switch (comparator.operator) {
    case "=":
      return comparison === 0;

    case ">":
      return comparison > 0;

    case ">=":
      return comparison >= 0;

    case "<":
      return comparison < 0;

    case "<=":
      return comparison <= 0;

    case "^": {
      if (comparison < 0) {
        return false;
      }

      const upper =
        comparator.version.major > 0
          ? {
              major:
                comparator.version.major + 1,
              minor: 0,
              patch: 0,
              prerelease: [],
            }
          : comparator.version.minor > 0
            ? {
                major: 0,
                minor:
                  comparator.version.minor + 1,
                patch: 0,
                prerelease: [],
              }
            : {
                major: 0,
                minor: 0,
                patch:
                  comparator.version.patch + 1,
                prerelease: [],
              };

      return compareManifestSemVer(
        version,
        upper
      ) < 0;
    }

    case "~": {
      if (comparison < 0) {
        return false;
      }

      return compareManifestSemVer(
        version,
        {
          major: comparator.version.major,
          minor:
            comparator.version.minor + 1,
          patch: 0,
          prerelease: [],
        }
      ) < 0;
    }
  }
}

export function satisfiesManifestVersionRange(
  version: string,
  range: string
): boolean {
  const parsedVersion =
    parseManifestSemVer(version);

  const comparators =
    parseRange(range);

  if (
    parsedVersion.prerelease.length > 0 &&
    !comparators.some(
      (comparator) =>
        comparator.version.major ===
          parsedVersion.major &&
        comparator.version.minor ===
          parsedVersion.minor &&
        comparator.version.patch ===
          parsedVersion.patch &&
        comparator.version.prerelease
          .length > 0
    )
  ) {
    return false;
  }

  return comparators.every(
    (comparator) =>
      satisfiesComparator(
        parsedVersion,
        comparator
      )
  );
}
