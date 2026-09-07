import { test } from "node:test";
import assert from "node:assert/strict";

import {
  anonymizeClient,
  logSecurityEvent,
  redact,
} from "../../app/lib/securityLog.ts";

/*
 * AEGIS-008 regression tests.
 *
 * These lock in the guarantee that security telemetry never becomes a
 * secret-disclosure channel. If a future change causes a credential to reach
 * the log stream, these fail.
 */

test("redacts credentials that must never reach logs", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    [
      "https://api.themoviedb.org/3/movie/1?api_key=abcd1234SECRETVALUE",
      "abcd1234SECRETVALUE",
    ],
    [
      "authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456",
      "sk-abcdefghijklmnopqrstuvwxyz123456",
    ],
    [
      "leaked ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 here",
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    ],
    [
      "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
      "eyJhbGciOiJIUzI1NiJ9",
    ],
    ["password=hunter2supersecret", "hunter2supersecret"],
    [
      "https://user:p4ssw0rdvalue@internal.host/x",
      "p4ssw0rdvalue",
    ],
  ];

  for (const [input, secret] of cases) {
    assert.ok(
      !redact(input).includes(secret),
      `redact() leaked a secret from: ${input.slice(0, 40)}`
    );
  }
});

test("preserves attack payloads so events stay actionable", () => {
  assert.ok(
    redact("550/../../account").includes("../../account")
  );
});

test("bounds field length so logs cannot be flooded", () => {
  assert.ok(redact("A".repeat(5_000)).length < 260);
});

test("anonymizes client addresses", () => {
  assert.equal(
    anonymizeClient("203.0.113.45"),
    "203.0.x.x"
  );

  assert.ok(
    !anonymizeClient(
      "2001:db8:85a3::8a2e:370:7334"
    ).includes("8a2e")
  );

  assert.equal(
    anonymizeClient("unknown"),
    "unknown"
  );
});

test("emits structured single-line JSON", () => {
  const original = console.warn;

  let captured = "";

  console.warn = (line: string) => {
    captured = line;
  };

  try {
    logSecurityEvent(
      {
        event: "input_validation_failed",
        route: "/api/movie",
        outcome: "blocked",
        reason: "non_numeric_movie_id",
        detail: "550/../../account",
        finding: "AEGIS-001",
      },
      "203.0.113.45"
    );
  } finally {
    console.warn = original;
  }

  assert.ok(!captured.includes("\n"));

  const parsed = JSON.parse(captured);

  assert.equal(parsed.event, "input_validation_failed");
  assert.equal(parsed.route, "/api/movie");
  assert.equal(parsed.finding, "AEGIS-001");
  assert.equal(parsed.client, "203.0.x.x");
  assert.ok(String(parsed.detail).includes("../../account"));
});

test("never breaks a request when the log sink fails", () => {
  const original = console.warn;

  console.warn = () => {
    throw new Error("log sink down");
  };

  try {
    assert.doesNotThrow(() =>
      logSecurityEvent({
        event: "rate_limit_exceeded",
        route: "/api/ai/chat",
        outcome: "blocked",
      })
    );
  } finally {
    console.warn = original;
  }
});
