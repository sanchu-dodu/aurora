import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

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
  "authenticated URL redaction preserves custom schemes and multiple authorities",
  () => {
    const cases = [
      ["CUSTOM+v1.2://name:p:a:ss@example.com", "CUSTOM+v1.2://[REDACTED]@example.com"],
      ["Kſ://name:pass@example.com", "Kſ://[REDACTED]@example.com"],
      ["https://name@example.com", "https://[REDACTED]@example.com"],
      ["custom://name:@example.com", "custom://[REDACTED]@example.com"],
      [".custom://name:pass@example.com", ".custom://[REDACTED]@example.com"],
      ["12+-custom://name:pass@example.com", "12+-custom://[REDACTED]@example.com"],
      ["custom://:pass@example.com", "custom://:pass@example.com"],
      ["custom://name:pass/path@example.com", "custom://name:pass/path@example.com"],
      ["custom://name:pass more@example.com", "custom://name:pass more@example.com"],
      ["123+.-://name:pass@example.com", "123+.-://name:pass@example.com"],
      ["https://user:custom://name:pass@example.com", "https://user:custom://[REDACTED]@example.com"],
      ["https://one:pass@first.test custom://two:pass@second.test",
        "https://[REDACTED]@first.test custom://[REDACTED]@second.test"],
    ];
    for (const [input, expected] of cases) {
      assert.equal(redactText(input), expected);
    }
  }
);

test(
  "long text, credential authorities, and a valid large file plan complete in a bounded subprocess",
  () => {
    const redactorUrl = new URL("../../dist/security/secretRedactor.js", import.meta.url).href;
    const serviceUrl = new URL("../../dist/operations/operationPlanService.js", import.meta.url).href;
    const script = `
      import assert from "node:assert/strict";
      import { mkdtemp, rm } from "node:fs/promises";
      import { tmpdir } from "node:os";
      import { join } from "node:path";
      const { redactText } = await import(${JSON.stringify(redactorUrl)});
      const { OperationPlanService } = await import(${JSON.stringify(serviceUrl)});
      const plain = "a".repeat(900000);
      assert.equal(redactText(plain), plain);
      const patterned = "a-.".repeat(300000);
      assert.equal(redactText(patterned), patterned);
      const credentials = "custom://" + "u".repeat(400000) + ":" + "p".repeat(400000) + "@example.com";
      assert.equal(redactText(credentials), "custom://[REDACTED]@example.com");
      const projectRoot = await mkdtemp(join(tmpdir(), "aurora-redactor-plan-"));
      try {
        const content = "x".repeat(256 * 1024);
        const plan = await new OperationPlanService().createFileWriteBatchPlan({
          projectRoot, intent: "test.large-plan", summary: "Preview one large source file.",
          files: [{ relativePath: "value.txt", content }],
        });
        assert.equal(plan.operations[0].content, content);
        assert.deepEqual(plan.operations[0].expected, { exists: false });
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
      console.log("bounded redactor and plan checks passed");
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024,
    });
    assert.equal(output.trim(), "bounded redactor and plan checks passed");
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
