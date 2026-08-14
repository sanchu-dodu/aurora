import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeJson,
  PackageCanonicalJsonError,
} from "../../dist/packages/trust/packageCanonicalJson.js";

test(
  "canonical JSON is deterministic across object insertion order",
  () => {
    const left = {
      z: 1,
      a: "aurora",
      nested: {
        b: true,
        a: null,
      },
      array: [
        3,
        "x",
        false,
      ],
    };

    const right = {
      array: [
        3,
        "x",
        false,
      ],
      nested: {
        a: null,
        b: true,
      },
      a: "aurora",
      z: 1,
    };

    const expected =
      '{"a":"aurora","array":[3,"x",false],"nested":{"a":null,"b":true},"z":1}';

    assert.equal(
      canonicalizeJson(left),
      expected
    );

    assert.equal(
      canonicalizeJson(right),
      expected
    );
  }
);

test(
  "canonical JSON preserves array order",
  () => {
    assert.notEqual(
      canonicalizeJson({
        values: [
          "a",
          "b",
        ],
      }),
      canonicalizeJson({
        values: [
          "b",
          "a",
        ],
      })
    );
  }
);

test(
  "canonical JSON uses deterministic finite number serialization",
  () => {
    assert.equal(
      canonicalizeJson({
        negativeZero: -0,
        integer: 42,
        fraction: 1.5,
      }),
      '{"fraction":1.5,"integer":42,"negativeZero":0}'
    );

    assert.throws(
      () =>
        canonicalizeJson(
          Number.NaN
        ),
      PackageCanonicalJsonError
    );

    assert.throws(
      () =>
        canonicalizeJson(
          Number.POSITIVE_INFINITY
        ),
      PackageCanonicalJsonError
    );
  }
);

test(
  "canonical JSON rejects non-JSON value types",
  () => {
    for (
      const value
      of [
        undefined,
        1n,
        () => undefined,
        Symbol("aurora"),
      ]
    ) {
      assert.throws(
        () =>
          canonicalizeJson(
            value
          ),
        PackageCanonicalJsonError
      );
    }
  }
);

test(
  "canonical JSON rejects sparse or decorated arrays",
  () => {
    const sparse =
      new Array(2);

    sparse[1] =
      "value";

    assert.throws(
      () =>
        canonicalizeJson(
          sparse
        ),
      PackageCanonicalJsonError
    );

    const decorated = [
      "value",
    ];

    decorated.extra =
      true;

    assert.throws(
      () =>
        canonicalizeJson(
          decorated
        ),
      PackageCanonicalJsonError
    );
  }
);

test(
  "canonical JSON rejects getters, hidden properties, symbols, and custom prototypes",
  () => {
    const getterObject = {};

    Object.defineProperty(
      getterObject,
      "value",
      {
        enumerable: true,
        get() {
          throw new Error(
            "getter must never execute"
          );
        },
      }
    );

    assert.throws(
      () =>
        canonicalizeJson(
          getterObject
        ),
      PackageCanonicalJsonError
    );

    const hidden = {
      visible: true,
    };

    Object.defineProperty(
      hidden,
      "hidden",
      {
        enumerable: false,
        value: true,
      }
    );

    assert.throws(
      () =>
        canonicalizeJson(
          hidden
        ),
      PackageCanonicalJsonError
    );

    const symbolObject = {
      visible: true,
    };

    symbolObject[
      Symbol("hidden")
    ] =
      true;

    assert.throws(
      () =>
        canonicalizeJson(
          symbolObject
        ),
      PackageCanonicalJsonError
    );

    class CustomObject {
      constructor() {
        this.value =
          true;
      }
    }

    assert.throws(
      () =>
        canonicalizeJson(
          new CustomObject()
        ),
      PackageCanonicalJsonError
    );
  }
);

test(
  "canonical JSON rejects cyclic structures",
  () => {
    const cyclic = {};

    cyclic.self =
      cyclic;

    assert.throws(
      () =>
        canonicalizeJson(
          cyclic
        ),
      PackageCanonicalJsonError
    );
  }
);

test(
  "canonical JSON rejects unpaired UTF-16 surrogates",
  () => {
    assert.throws(
      () =>
        canonicalizeJson(
          "\ud800"
        ),
      PackageCanonicalJsonError
    );

    assert.throws(
      () =>
        canonicalizeJson({
          "\udc00": true,
        }),
      PackageCanonicalJsonError
    );

    assert.doesNotThrow(
      () =>
        canonicalizeJson(
          "Aurora \ud83c\udf0c"
        )
    );
  }
);