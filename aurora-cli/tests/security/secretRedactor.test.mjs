import test from "node:test";
import assert from "node:assert/strict";

import {
  REDACTED_VALUE,
  isSensitiveKey,
  redactSensitiveValue,
  redactText,
} from "../../dist/security/secretRedactor.js";

import {
  logger,
} from "../../dist/core/logger.js";

test(
  "secret redaction covers credentials, headers, cookies, query values, and known tokens",
  () => {
    const githubToken =
      `ghp_${"a".repeat(36)}`;

    const input = [
      "https://user:password@example.com/private",
      "https://example.com?access_token=query-secret&safe=yes",
      "Authorization: Bearer header-secret",
      "Cookie: session=cookie-secret",
      '{"clientSecret":"json-secret"}',
      "password=pair-secret",
      githubToken,
    ].join("\n");

    const output = redactText(input);

    for (
      const secret of [
        "user:password",
        "query-secret",
        "header-secret",
        "cookie-secret",
        "json-secret",
        "pair-secret",
        githubToken,
      ]
    ) {
      assert.equal(
        output.includes(secret),
        false
      );
    }

    assert.match(
      output,
      /https:\/\/\[REDACTED\]@example\.com/u
    );
    assert.match(
      output,
      /access_token=\[REDACTED\]/u
    );
    assert.match(
      output,
      /Authorization: \[REDACTED\]/u
    );
  }
);

test(
  "explicit runtime secrets are removed without exposing harmless text",
  () => {
    const secret =
      "unstructured-value-123";

    assert.equal(
      redactText(
        `before ${secret} after`,
        [
          secret,
        ]
      ),
      `before ${REDACTED_VALUE} after`
    );

    assert.equal(
      redactText(
        "Tokenization is harmless."
      ),
      "Tokenization is harmless."
    );
  }
);

test(
  "structured redaction replaces secret fields recursively",
  () => {
    const value = {
      name: "aurora",
      credentials: {
        apiKey: "nested-secret",
      },
      items: [
        {
          sessionToken:
            "another-secret",
        },
      ],
    };

    assert.deepEqual(
      redactSensitiveValue(value),
      {
        name: "aurora",
        credentials:
          REDACTED_VALUE,
        items: [
          {
            sessionToken:
              REDACTED_VALUE,
          },
        ],
      }
    );

    assert.equal(
      isSensitiveKey(
        "refresh_token"
      ),
      true
    );
    assert.equal(
      isSensitiveKey(
        "tokenization"
      ),
      false
    );
  }
);

test(
  "the shared logger redacts dynamic messages before writing output",
  () => {
    const original =
      console.error;
    const messages = [];

    console.error = message => {
      messages.push(
        String(message)
      );
    };

    try {
      logger.error(
        "Authorization: Bearer logger-secret"
      );
    } finally {
      console.error = original;
    }

    assert.equal(
      messages.length,
      1
    );
    assert.equal(
      messages[0].includes(
        "logger-secret"
      ),
      false
    );
    assert.match(
      messages[0],
      /\[REDACTED\]/u
    );
  }
);
