import assert from "node:assert/strict";
import test from "node:test";

import {
  PACKAGE_MANIFEST_MAX_BYTES,
  PACKAGE_MANIFEST_MAX_DEPTH,
  PackageManifestJsonError,
  parsePackageManifestBytes,
  parsePackageManifestJson,
} from "../../dist/packages/trust/packageManifestJson.js";

test(
  "strict package manifest JSON accepts an ordinary object document",
  () => {
    const parsed =
      parsePackageManifestJson(
        `{
          "manifestVersion": 1,
          "kind": "package",
          "id": "example",
          "publisher": {
            "id": "aurora"
          },
          "values": [
            true,
            false,
            null,
            -12.5e2
          ]
        }`
      );

    assert.equal(
      parsed.manifestVersion,
      1
    );

    assert.equal(
      parsed.id,
      "example"
    );

    assert.deepEqual(
      parsed.values,
      [
        true,
        false,
        null,
        -1250,
      ]
    );
  }
);

test(
  "strict package manifest JSON rejects duplicate top-level keys",
  () => {
    assert.throws(
      () =>
        parsePackageManifestJson(
          `{
            "id": "first",
            "id": "second"
          }`
        ),
      error => {
        assert.ok(
          error instanceof
            PackageManifestJsonError
        );

        assert.match(
          error.message,
          /duplicate object property 'id'/
        );

        return true;
      }
    );
  }
);

test(
  "strict package manifest JSON rejects duplicate nested keys",
  () => {
    assert.throws(
      () =>
        parsePackageManifestJson(
          `{
            "publisher": {
              "id": "aurora",
              "id": "attacker"
            }
          }`
        ),
      PackageManifestJsonError
    );

    assert.throws(
      () =>
        parsePackageManifestJson(
          `{
            "items": [
              {
                "digest": "a",
                "digest": "b"
              }
            ]
          }`
        ),
      PackageManifestJsonError
    );
  }
);

test(
  "escaped property names cannot bypass duplicate-key detection",
  () => {
    assert.throws(
      () =>
        parsePackageManifestJson(
          `{
            "publisher": "first",
            "\\u0070ublisher": "second"
          }`
        ),
      error => {
        assert.ok(
          error instanceof
            PackageManifestJsonError
        );

        assert.match(
          error.message,
          /duplicate object property 'publisher'/
        );

        return true;
      }
    );

    assert.throws(
      () =>
        parsePackageManifestJson(
          `{
            "\\u0061": 1,
            "a": 2
          }`
        ),
      PackageManifestJsonError
    );
  }
);

test(
  "strict package manifest JSON rejects malformed JSON grammar",
  () => {
    for (
      const candidate
      of [
        "",
        "null",
        "[]",
        "{",
        '{"a":1,}',
        '{"a":}',
        "{a:1}",
        '{"a" 1}',
        '{"a":01}',
        '{"a":.5}',
        '{"a":1.}',
        '{"a":1e}',
        '{"a":+1}',
        '{"a":"unterminated}',
        '{"a":"\\x20"}',
        '{"a":"line\nbreak"}',
        '{"a":true} trailing',
      ]
    ) {
      assert.throws(
        () =>
          parsePackageManifestJson(
            candidate
          ),
        PackageManifestJsonError,
        candidate
      );
    }
  }
);

test(
  "strict package manifest JSON rejects non-finite numeric results",
  () => {
    assert.throws(
      () =>
        parsePackageManifestJson(
          '{"value":1e400}'
        ),
      error => {
        assert.ok(
          error instanceof
            PackageManifestJsonError
        );

        assert.match(
          error.message,
          /finite JavaScript number/
        );

        return true;
      }
    );
  }
);

test(
  "strict package manifest JSON rejects a UTF-8 BOM",
  () => {
    assert.throws(
      () =>
        parsePackageManifestJson(
          '\ufeff{"id":"example"}'
        ),
      PackageManifestJsonError
    );
  }
);

test(
  "strict package manifest JSON rejects unpaired Unicode surrogates",
  () => {
    assert.throws(
      () =>
        parsePackageManifestJson(
          '{"value":"\\ud800"}'
        ),
      PackageManifestJsonError
    );

    assert.throws(
      () =>
        parsePackageManifestJson(
          '{"\\udc00":true}'
        ),
      PackageManifestJsonError
    );

    assert.doesNotThrow(
      () =>
        parsePackageManifestJson(
          '{"value":"\\ud83c\\udf0c"}'
        )
    );
  }
);

test(
  "strict package manifest JSON enforces the nesting-depth limit",
  () => {
    const safe =
      `${'{"x":'.repeat(
        PACKAGE_MANIFEST_MAX_DEPTH
      )}null${"}".repeat(
        PACKAGE_MANIFEST_MAX_DEPTH
      )}`;

    assert.doesNotThrow(
      () =>
        parsePackageManifestJson(
          safe
        )
    );

    const tooDeep =
      `${'{"x":'.repeat(
        PACKAGE_MANIFEST_MAX_DEPTH +
        1
      )}null${"}".repeat(
        PACKAGE_MANIFEST_MAX_DEPTH +
        1
      )}`;

    assert.throws(
      () =>
        parsePackageManifestJson(
          tooDeep
        ),
      error => {
        assert.ok(
          error instanceof
            PackageManifestJsonError
        );

        assert.match(
          error.message,
          /nesting depth/
        );

        return true;
      }
    );
  }
);

test(
  "strict package manifest JSON enforces its UTF-8 byte-size limit",
  () => {
    const overhead =
      Buffer.byteLength(
        '{"value":""}',
        "utf8"
      );

    const exactPayload =
      "a".repeat(
        PACKAGE_MANIFEST_MAX_BYTES -
        overhead
      );

    assert.doesNotThrow(
      () =>
        parsePackageManifestJson(
          `{"value":"${exactPayload}"}`
        )
    );

    assert.throws(
      () =>
        parsePackageManifestJson(
          `{"value":"${exactPayload}a"}`
        ),
      error => {
        assert.ok(
          error instanceof
            PackageManifestJsonError
        );

        assert.match(
          error.message,
          /byte size limit/
        );

        return true;
      }
    );
  }
);

test(
  "duplicate detection uses decoded JSON property names without changing valid values",
  () => {
    const parsed =
      parsePackageManifestJson(
        `{
          "\\u0069d": "example",
          "description": "\\u0041urora",
          "nested": {
            "\\u006bey": "value"
          }
        }`
      );

    assert.equal(
      parsed.id,
      "example"
    );

    assert.equal(
      parsed.description,
      "Aurora"
    );

    assert.deepEqual(
      parsed.nested,
      {
        key:
          "value",
      }
    );
  }
);
test(
  "strict package manifest bytes reject malformed UTF-8 before JSON parsing",
  () => {
    const malformed =
      Buffer.from([
        0x7b,
        0x22,
        0x69,
        0x64,
        0x22,
        0x3a,
        0x22,
        0xc3,
        0x28,
        0x22,
        0x7d,
      ]);

    assert.throws(
      () =>
        parsePackageManifestBytes(
          malformed
        ),
      error => {
        assert.ok(
          error instanceof
            PackageManifestJsonError
        );

        assert.match(
          error.message,
          /valid UTF-8/
        );

        return true;
      }
    );
  }
);

test(
  "strict package manifest bytes reject a byte-level UTF-8 BOM",
  () => {
    const content =
      Buffer.concat([
        Buffer.from([
          0xef,
          0xbb,
          0xbf,
        ]),
        Buffer.from(
          '{"id":"example"}',
          "utf8"
        ),
      ]);

    assert.throws(
      () =>
        parsePackageManifestBytes(
          content
        ),
      error => {
        assert.ok(
          error instanceof
            PackageManifestJsonError
        );

        assert.match(
          error.message,
          /UTF-8 BOM/
        );

        return true;
      }
    );
  }
);