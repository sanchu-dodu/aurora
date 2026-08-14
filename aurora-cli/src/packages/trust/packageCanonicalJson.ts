export class PackageCanonicalJsonError
  extends TypeError {}

function fail(
  path: string,
  message: string
): never {
  throw new PackageCanonicalJsonError(
    `Cannot canonicalize JSON at ${path}: ${message}`
  );
}

function assertWellFormedUnicode(
  value: string,
  path: string
): void {
  for (
    let index = 0;
    index < value.length;
    index++
  ) {
    const code =
      value.charCodeAt(index);

    const isHighSurrogate =
      code >= 0xd800 &&
      code <= 0xdbff;

    const isLowSurrogate =
      code >= 0xdc00 &&
      code <= 0xdfff;

    if (isHighSurrogate) {
      if (
        index + 1 >= value.length
      ) {
        fail(
          path,
          "strings cannot contain an unpaired UTF-16 high surrogate."
        );
      }

      const next =
        value.charCodeAt(
          index + 1
        );

      if (
        next < 0xdc00 ||
        next > 0xdfff
      ) {
        fail(
          path,
          "strings cannot contain an unpaired UTF-16 high surrogate."
        );
      }

      index++;

      continue;
    }

    if (isLowSurrogate) {
      fail(
        path,
        "strings cannot contain an unpaired UTF-16 low surrogate."
      );
    }
  }
}

function quoteString(
  value: string,
  path: string
): string {
  assertWellFormedUnicode(
    value,
    path
  );

  const encoded =
    JSON.stringify(value);

  if (encoded === undefined) {
    fail(
      path,
      "string serialization failed."
    );
  }

  return encoded;
}

function serializeArray(
  value: readonly unknown[],
  path: string,
  ancestors: WeakSet<object>
): string {
  if (ancestors.has(value)) {
    fail(
      path,
      "cyclic structures are not valid JSON."
    );
  }

  if (
    Object.getOwnPropertySymbols(
      value
    ).length > 0
  ) {
    fail(
      path,
      "arrays cannot contain symbol properties."
    );
  }

  const ownNames =
    Object.getOwnPropertyNames(
      value
    );

  const expectedNames =
    new Set<string>([
      "length",
      ...Array.from(
        {
          length: value.length,
        },
        (
          _entry,
          index
        ) => String(index)
      ),
    ]);

  if (
    ownNames.length !==
      expectedNames.size ||
    ownNames.some(
      name =>
        !expectedNames.has(name)
    )
  ) {
    fail(
      path,
      "arrays must be dense and cannot contain additional own properties."
    );
  }

  for (
    let index = 0;
    index < value.length;
    index++
  ) {
    const descriptor =
      Object.getOwnPropertyDescriptor(
        value,
        String(index)
      );

    if (
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      fail(
        `${path}[${index}]`,
        "array elements must be enumerable data properties."
      );
    }
  }

  ancestors.add(value);

  try {
    const entries: string[] =
      [];

    for (
      let index = 0;
      index < value.length;
      index++
    ) {
      const descriptor =
        Object.getOwnPropertyDescriptor(
          value,
          String(index)
        );

      if (
        !descriptor ||
        !("value" in descriptor)
      ) {
        fail(
          `${path}[${index}]`,
          "array element could not be read safely."
        );
      }

      entries.push(
        serializeValue(
          descriptor.value,
          `${path}[${index}]`,
          ancestors
        )
      );
    }

    return `[${entries.join(",")}]`;
  }
  finally {
    ancestors.delete(value);
  }
}

function serializeObject(
  value: object,
  path: string,
  ancestors: WeakSet<object>
): string {
  const prototype =
    Object.getPrototypeOf(value);

  if (
    prototype !==
      Object.prototype &&
    prototype !== null
  ) {
    fail(
      path,
      "objects must use Object.prototype or a null prototype."
    );
  }

  if (ancestors.has(value)) {
    fail(
      path,
      "cyclic structures are not valid JSON."
    );
  }

  if (
    Object.getOwnPropertySymbols(
      value
    ).length > 0
  ) {
    fail(
      path,
      "objects cannot contain symbol properties."
    );
  }

  const keys =
    Object.getOwnPropertyNames(
      value
    );

  for (const key of keys) {
    assertWellFormedUnicode(
      key,
      `${path} property name`
    );

    const descriptor =
      Object.getOwnPropertyDescriptor(
        value,
        key
      );

    if (
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      fail(
        `${path}.${key}`,
        "objects may contain only enumerable data properties."
      );
    }
  }

  keys.sort(
    (
      left,
      right
    ) => {
      if (left < right) {
        return -1;
      }

      if (left > right) {
        return 1;
      }

      return 0;
    }
  );

  ancestors.add(value);

  try {
    const entries =
      keys.map(
        key => {
          const descriptor =
            Object.getOwnPropertyDescriptor(
              value,
              key
            );

          if (
            !descriptor ||
            !("value" in descriptor)
          ) {
            fail(
              `${path}.${key}`,
              "object property could not be read safely."
            );
          }

          return (
            `${quoteString(
              key,
              `${path} property name`
            )}:` +
            serializeValue(
              descriptor.value,
              `${path}.${key}`,
              ancestors
            )
          );
        }
      );

    return `{${entries.join(",")}}`;
  }
  finally {
    ancestors.delete(value);
  }
}

function serializeValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>
): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
      return value
        ? "true"
        : "false";

    case "number": {
      if (!Number.isFinite(value)) {
        fail(
          path,
          "numbers must be finite."
        );
      }

      const encoded =
        JSON.stringify(value);

      if (encoded === undefined) {
        fail(
          path,
          "number serialization failed."
        );
      }

      return encoded;
    }

    case "string":
      return quoteString(
        value,
        path
      );

    case "object":
      if (Array.isArray(value)) {
        return serializeArray(
          value,
          path,
          ancestors
        );
      }

      return serializeObject(
        value,
        path,
        ancestors
      );

    case "undefined":
    case "bigint":
    case "function":
    case "symbol":
      return fail(
        path,
        `values of type '${typeof value}' are not valid canonical JSON.`
      );

    default:
      return fail(
        path,
        `values of type '${typeof value}' are not supported by canonical JSON.`
      );
  }
}

export function canonicalizeJson(
  value: unknown
): string {
  return serializeValue(
    value,
    "$",
    new WeakSet<object>()
  );
}