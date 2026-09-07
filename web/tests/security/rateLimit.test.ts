import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bearerToken,
} from "../../app/lib/firebaseIdToken.ts";

import {
  clientKey,
  rateLimit,
} from "../../app/lib/rateLimit.ts";

/*
 * AEGIS-003 regression tests for throttling and credential parsing.
 */

test("allows requests up to the limit, then blocks", () => {
  const key = `test-allow-${Math.random()}`;

  for (let index = 0; index < 5; index++) {
    assert.equal(
      rateLimit(key, 5, 60_000).allowed,
      true,
      `request ${index + 1} should be allowed`
    );
  }

  const blocked = rateLimit(key, 5, 60_000);

  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test("tracks separate callers independently", () => {
  const suffix = Math.random();

  for (let index = 0; index < 3; index++) {
    rateLimit(`caller-a-${suffix}`, 3, 60_000);
  }

  assert.equal(
    rateLimit(`caller-a-${suffix}`, 3, 60_000).allowed,
    false
  );

  assert.equal(
    rateLimit(`caller-b-${suffix}`, 3, 60_000).allowed,
    true
  );
});

test("resets after the window elapses", () => {
  const key = `test-window-${Math.random()}`;

  assert.equal(rateLimit(key, 1, 1).allowed, true);
  assert.equal(rateLimit(key, 1, 1).allowed, false);

  const start = Date.now();

  while (Date.now() - start < 5) {
    /* wait for the 1ms window to elapse */
  }

  assert.equal(rateLimit(key, 1, 1).allowed, true);
});

test("derives a client key from proxy headers", () => {
  assert.equal(
    clientKey(
      new Request("http://localhost/", {
        headers: {
          "x-forwarded-for": "203.0.113.5, 10.0.0.1",
        },
      })
    ),
    "203.0.113.5"
  );

  assert.equal(
    clientKey(new Request("http://localhost/")),
    "unknown"
  );
});

test("classifies authorization headers correctly", () => {
  const of = (headers: Record<string, string>) =>
    bearerToken(
      new Request("http://localhost/", { headers })
    );

  assert.equal(of({}).kind, "absent");

  /*
   * A scheme this route does not understand is treated as anonymous rather
   * than an error.
   */
  assert.equal(
    of({ authorization: "Basic dXNlcjpwYXNz" }).kind,
    "absent"
  );

  /*
   * Regression guard: "Bearer" with an empty value is a presented but
   * invalid credential. Treating it as anonymous would let a caller probe
   * the authentication boundary without raising a security signal. This
   * exact case was caught by independent verification.
   */
  assert.equal(
    of({ authorization: "Bearer" }).kind,
    "malformed"
  );

  assert.equal(
    of({ authorization: "Bearer   " }).kind,
    "malformed"
  );

  const valid = of({
    authorization: "Bearer abc.def.ghi",
  });

  assert.equal(valid.kind, "token");
  assert.equal(
    valid.kind === "token" ? valid.token : null,
    "abc.def.ghi"
  );
});
