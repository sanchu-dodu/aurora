import test from "node:test";
import assert from "node:assert/strict";

import {
  AuroraError,
} from "../../dist/errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  formatFatalError,
  getErrorMessage,
} from "../../dist/errors/formatError.js";

test(
  "AuroraError preserves structured failure metadata",
  () => {
    const cause =
      new Error(
        "Underlying failure"
      );

    const error =
      new AuroraError(
        "Template is unavailable.",
        {
          code:
            ErrorCodes
              .TEMPLATE_NOT_FOUND,

          suggestion:
            "List available templates.",

          cause,
        }
      );

    assert.equal(
      error.name,
      "AuroraError"
    );

    assert.equal(
      error.code,
      "TEMPLATE_NOT_FOUND"
    );

    assert.equal(
      error.suggestion,
      "List available templates."
    );

    assert.equal(
      error.cause,
      cause
    );
  }
);

test(
  "formatFatalError formats structured Aurora errors",
  () => {
    const formatted =
      formatFatalError(
        new AuroraError(
          "Template 'missing' not found.",
          {
            code:
              ErrorCodes
                .TEMPLATE_NOT_FOUND,

            suggestion:
              "Search available templates.",
          }
        )
      );

    assert.match(
      formatted,
      /Code: TEMPLATE_NOT_FOUND/
    );

    assert.match(
      formatted,
      /Message: Template 'missing' not found\./
    );

    assert.match(
      formatted,
      /Suggestion: Search available templates\./
    );
  }
);

test(
  "formatFatalError preserves aggregate failure details",
  () => {
    const formatted =
      formatFatalError(
        new AggregateError(
          [
            new AuroraError(
              "Plugin activation failed.",
              {
                code:
                  ErrorCodes
                    .UNKNOWN_PLUGIN_ACTION,
              }
            ),

            new Error(
              "Runtime shutdown failed."
            ),
          ],
          "Multiple failures"
        )
      );

    assert.match(
      formatted,
      /\[UNKNOWN_PLUGIN_ACTION\] Plugin activation failed\./
    );

    assert.match(
      formatted,
      /Runtime shutdown failed\./
    );
  }
);

test(
  "getErrorMessage safely handles non-Error values",
  () => {
    assert.equal(
      getErrorMessage(
        "plain failure"
      ),
      "plain failure"
    );

    assert.equal(
      getErrorMessage(
        42
      ),
      "42"
    );
  }
);

test(
  "fatal error formatting redacts credentials from every error shape",
  () => {
    const secret =
      "formatting-secret";
    const formatted =
      formatFatalError(
        new AggregateError(
          [
            new AuroraError(
              `Authorization: Bearer ${secret}`,
              {
                code:
                  ErrorCodes
                    .CREDENTIAL_STORE_FAILED,
                suggestion:
                  `password=${secret}`,
              }
            ),
            new Error(
              `https://user:${secret}@example.com/private`
            ),
          ],
          `token=${secret}`
        )
      );

    assert.equal(
      formatted.includes(secret),
      false
    );
    assert.match(
      formatted,
      /\[REDACTED\]/u
    );
  }
);
