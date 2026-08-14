import {
  TextDecoder,
} from "node:util";
export const PACKAGE_MANIFEST_MAX_BYTES =
  1024 * 1024;

export const PACKAGE_MANIFEST_MAX_DEPTH =
  128;

export class PackageManifestJsonError
extends SyntaxError {
  constructor(
    message: string
  ) {
    super(message);

    this.name =
      "PackageManifestJsonError";
  }
}

class StrictJsonScanner {
  private index = 0;

  constructor(
    private readonly source: string
  ) {}

  parse(): void {
    this.skipWhitespace();

    this.parseValue(
      0
    );

    this.skipWhitespace();

    if (
      this.index !==
      this.source.length
    ) {
      this.fail(
        "unexpected trailing content"
      );
    }
  }

  private parseValue(
    depth: number
  ): void {
    if (
      depth >
      PACKAGE_MANIFEST_MAX_DEPTH
    ) {
      this.fail(
        `maximum JSON nesting depth of ${PACKAGE_MANIFEST_MAX_DEPTH} exceeded`
      );
    }

    const current =
      this.source[
        this.index
      ];

    if (
      current ===
      "{"
    ) {
      this.parseObject(
        depth + 1
      );

      return;
    }

    if (
      current ===
      "["
    ) {
      this.parseArray(
        depth + 1
      );

      return;
    }

    if (
      current ===
      '"'
    ) {
      this.parseString();

      return;
    }

    if (
      current ===
      "-" ||
      (
        current !== undefined &&
        current >= "0" &&
        current <= "9"
      )
    ) {
      this.parseNumber();

      return;
    }

    if (
      this.consumeLiteral(
        "true"
      ) ||
      this.consumeLiteral(
        "false"
      ) ||
      this.consumeLiteral(
        "null"
      )
    ) {
      return;
    }

    this.fail(
      "expected a JSON value"
    );
  }

  private parseObject(
    depth: number
  ): void {
    this.expect(
      "{"
    );

    this.skipWhitespace();

    const keys =
      new Set<string>();

    if (
      this.peek() ===
      "}"
    ) {
      this.index++;

      return;
    }

    while (true) {
      if (
        this.peek() !==
        '"'
      ) {
        this.fail(
          "object property names must be JSON strings"
        );
      }

      const key =
        this.parseString();

      if (
        keys.has(key)
      ) {
        this.fail(
          `duplicate object property '${escapeForMessage(
            key
          )}'`
        );
      }

      keys.add(key);

      this.skipWhitespace();

      this.expect(
        ":"
      );

      this.skipWhitespace();

      this.parseValue(
        depth
      );

      this.skipWhitespace();

      const separator =
        this.peek();

      if (
        separator ===
        "}"
      ) {
        this.index++;

        return;
      }

      if (
        separator !==
        ","
      ) {
        this.fail(
          "expected ',' or '}' after object property"
        );
      }

      this.index++;

      this.skipWhitespace();
    }
  }

  private parseArray(
    depth: number
  ): void {
    this.expect(
      "["
    );

    this.skipWhitespace();

    if (
      this.peek() ===
      "]"
    ) {
      this.index++;

      return;
    }

    while (true) {
      this.parseValue(
        depth
      );

      this.skipWhitespace();

      const separator =
        this.peek();

      if (
        separator ===
        "]"
      ) {
        this.index++;

        return;
      }

      if (
        separator !==
        ","
      ) {
        this.fail(
          "expected ',' or ']' after array element"
        );
      }

      this.index++;

      this.skipWhitespace();
    }
  }

  private parseString():
    string {
    const start =
      this.index;

    this.expect(
      '"'
    );

    let escaped =
      false;

    while (
      this.index <
      this.source.length
    ) {
      const code =
        this.source.charCodeAt(
          this.index
        );

      const character =
        this.source[
          this.index
        ];

      if (!escaped) {
        if (
          character ===
          '"'
        ) {
          this.index++;

          const token =
            this.source.slice(
              start,
              this.index
            );

          let decoded: unknown;

          try {
            decoded =
              JSON.parse(
                token
              );
          }
          catch {
            this.fail(
              "invalid JSON string"
            );
          }

          if (
            typeof decoded !==
            "string"
          ) {
            this.fail(
              "invalid JSON string"
            );
          }

          assertWellFormedUnicode(
            decoded,
            message =>
              this.fail(
                message
              )
          );

          return decoded;
        }

        if (
          character ===
          "\\"
        ) {
          escaped =
            true;

          this.index++;

          continue;
        }

        if (
          code <=
          0x1f
        ) {
          this.fail(
            "unescaped control character in JSON string"
          );
        }

        this.index++;

        continue;
      }

      if (
        character === '"' ||
        character === "\\" ||
        character === "/" ||
        character === "b" ||
        character === "f" ||
        character === "n" ||
        character === "r" ||
        character === "t"
      ) {
        escaped =
          false;

        this.index++;

        continue;
      }

      if (
        character ===
        "u"
      ) {
        if (
          this.index + 4 >=
          this.source.length
        ) {
          this.fail(
            "incomplete Unicode escape"
          );
        }

        for (
          let offset = 1;
          offset <= 4;
          offset++
        ) {
          const hex =
            this.source[
              this.index +
              offset
            ];

          if (
            hex === undefined ||
            !/[0-9A-Fa-f]/u
              .test(hex)
          ) {
            this.fail(
              "invalid Unicode escape"
            );
          }
        }

        this.index +=
          5;

        escaped =
          false;

        continue;
      }

      this.fail(
        "invalid JSON escape sequence"
      );
    }

    this.fail(
      "unterminated JSON string"
    );
  }

  private parseNumber(): void {
    const start =
      this.index;

    if (
      this.peek() ===
      "-"
    ) {
      this.index++;
    }

    const integerStart =
      this.peek();

    if (
      integerStart ===
      "0"
    ) {
      this.index++;

      const next =
        this.peek();

      if (
        next !== undefined &&
        next >= "0" &&
        next <= "9"
      ) {
        this.fail(
          "JSON numbers cannot contain leading zeroes"
        );
      }
    }
    else {
      if (
        integerStart ===
          undefined ||
        integerStart <
          "1" ||
        integerStart >
          "9"
      ) {
        this.fail(
          "invalid JSON number"
        );
      }

      while (true) {
        const digit =
          this.peek();

        if (
          digit ===
            undefined ||
          digit <
            "0" ||
          digit >
            "9"
        ) {
          break;
        }

        this.index++;
      }
    }

    if (
      this.peek() ===
      "."
    ) {
      this.index++;

      const firstFraction =
        this.peek();

      if (
        firstFraction ===
          undefined ||
        firstFraction <
          "0" ||
        firstFraction >
          "9"
      ) {
        this.fail(
          "JSON fractional numbers require at least one digit"
        );
      }

      while (true) {
        const digit =
          this.peek();

        if (
          digit ===
            undefined ||
          digit <
            "0" ||
          digit >
            "9"
        ) {
          break;
        }

        this.index++;
      }
    }

    const exponent =
      this.peek();

    if (
      exponent === "e" ||
      exponent === "E"
    ) {
      this.index++;

      const sign =
        this.peek();

      if (
        sign === "+" ||
        sign === "-"
      ) {
        this.index++;
      }

      const firstExponent =
        this.peek();

      if (
        firstExponent ===
          undefined ||
        firstExponent <
          "0" ||
        firstExponent >
          "9"
      ) {
        this.fail(
          "JSON exponents require at least one digit"
        );
      }

      while (true) {
        const digit =
          this.peek();

        if (
          digit ===
            undefined ||
          digit <
            "0" ||
          digit >
            "9"
        ) {
          break;
        }

        this.index++;
      }
    }

    const token =
      this.source.slice(
        start,
        this.index
      );

    const value =
      Number(token);

    if (
      !Number.isFinite(
        value
      )
    ) {
      this.fail(
        "JSON number cannot be represented as a finite JavaScript number"
      );
    }
  }

  private consumeLiteral(
    literal: string
  ): boolean {
    if (
      !this.source
        .startsWith(
          literal,
          this.index
        )
    ) {
      return false;
    }

    this.index +=
      literal.length;

    return true;
  }

  private skipWhitespace(): void {
    while (
      this.index <
      this.source.length
    ) {
      const character =
        this.source[
          this.index
        ];

      if (
        character !== " " &&
        character !== "\t" &&
        character !== "\r" &&
        character !== "\n"
      ) {
        return;
      }

      this.index++;
    }
  }

  private peek():
    string |
    undefined {
    return this.source[
      this.index
    ];
  }

  private expect(
    expected: string
  ): void {
    if (
      this.peek() !==
      expected
    ) {
      this.fail(
        `expected '${expected}'`
      );
    }

    this.index++;
  }

  private fail(
    message: string
  ): never {
    throw new PackageManifestJsonError(
      `Invalid package manifest JSON at offset ${this.index}: ${message}.`
    );
  }
}

function assertWellFormedUnicode(
  value: string,
  fail: (
    message: string
  ) => never
): void {
  for (
    let index = 0;
    index < value.length;
    index++
  ) {
    const code =
      value.charCodeAt(
        index
      );

    if (
      code >= 0xd800 &&
      code <= 0xdbff
    ) {
      if (
        index + 1 >=
        value.length
      ) {
        fail(
          "JSON strings cannot contain an unpaired UTF-16 high surrogate"
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
          "JSON strings cannot contain an unpaired UTF-16 high surrogate"
        );
      }

      index++;

      continue;
    }

    if (
      code >= 0xdc00 &&
      code <= 0xdfff
    ) {
      fail(
        "JSON strings cannot contain an unpaired UTF-16 low surrogate"
      );
    }
  }
}

function escapeForMessage(
  value: string
): string {
  return value
    .replaceAll(
      "\\",
      "\\\\"
    )
    .replaceAll(
      "'",
      "\\'"
    )
    .replaceAll(
      "\r",
      "\\r"
    )
    .replaceAll(
      "\n",
      "\\n"
    )
    .replaceAll(
      "\t",
      "\\t"
    );
}

function assertManifestRoot(
  value: unknown
): asserts value is
  Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new PackageManifestJsonError(
      "Package manifest JSON root must be an object."
    );
  }

  const prototype =
    Object.getPrototypeOf(
      value
    );

  if (
    prototype !==
    Object.prototype
  ) {
    throw new PackageManifestJsonError(
      "Package manifest JSON root must use the ordinary JSON object prototype."
    );
  }
}

export function parsePackageManifestBytes(
  source: Uint8Array
): Record<string, unknown> {
  if (
    source.byteLength >
    PACKAGE_MANIFEST_MAX_BYTES
  ) {
    throw new PackageManifestJsonError(
      `Package manifest JSON exceeds the ${PACKAGE_MANIFEST_MAX_BYTES} byte size limit.`
    );
  }

  if (
    source.byteLength >= 3 &&
    source[0] === 0xef &&
    source[1] === 0xbb &&
    source[2] === 0xbf
  ) {
    throw new PackageManifestJsonError(
      "Package manifest JSON cannot begin with a UTF-8 BOM."
    );
  }

  let decoded: string;

  try {
    decoded =
      new TextDecoder(
        "utf-8",
        {
          fatal: true,
          ignoreBOM: true,
        }
      ).decode(source);
  }
  catch {
    throw new PackageManifestJsonError(
      "Package manifest bytes must contain valid UTF-8."
    );
  }

  return parsePackageManifestJson(
    decoded
  );
}
export function parsePackageManifestJson(
  source: string
): Record<string, unknown> {
  if (
    typeof source !==
    "string"
  ) {
    throw new PackageManifestJsonError(
      "Package manifest JSON source must be a string."
    );
  }

  if (
    Buffer.byteLength(
      source,
      "utf8"
    ) >
    PACKAGE_MANIFEST_MAX_BYTES
  ) {
    throw new PackageManifestJsonError(
      `Package manifest JSON exceeds the ${PACKAGE_MANIFEST_MAX_BYTES} byte size limit.`
    );
  }

  if (
    source.charCodeAt(
      0
    ) ===
    0xfeff
  ) {
    throw new PackageManifestJsonError(
      "Package manifest JSON cannot begin with a UTF-8 BOM."
    );
  }

  const scanner =
    new StrictJsonScanner(
      source
    );

  scanner.parse();

  let parsed: unknown;

  try {
    parsed =
      JSON.parse(
        source
      );
  }
  catch {
    throw new PackageManifestJsonError(
      "Package manifest JSON failed final JSON parsing."
    );
  }

  assertManifestRoot(
    parsed
  );

  return parsed;
}