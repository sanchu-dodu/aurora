import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";

import {
  createIdTokenVerifier,
  IdTokenError,
} from "../../app/lib/firebaseIdToken.ts";

/*
 * AEGIS-003 regression tests.
 *
 * Authentication is the highest-consequence code in this repository: a
 * verification weakness would let an attacker assume another user's identity.
 * These tests exercise the classic JWT bypass families against a locally
 * generated keypair. No network access and no real credentials are involved.
 */

const PROJECT_ID = "aurora-test-project";

const NOW = 1_700_000_000;

const trusted = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const attacker = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

function encode(value: object): string {
  return Buffer.from(
    JSON.stringify(value)
  ).toString("base64url");
}

function signToken(
  header: object,
  payload: object,
  key: KeyObject
): string {
  const head = encode(header);

  const body = encode(payload);

  const signer = createSign("RSA-SHA256");

  signer.update(`${head}.${body}`);

  signer.end();

  return `${head}.${body}.${signer
    .sign(key)
    .toString("base64url")}`;
}

function claims(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: "user-abc-123",
    iat: NOW - 60,
    exp: NOW + 3_600,
    auth_time: NOW - 60,
    email: "user@example.com",
    email_verified: true,
    ...overrides,
  };
}

const verifier = createIdTokenVerifier({
  projectId: PROJECT_ID,
  resolver: async () =>
    new Map([["trusted-kid", trusted.publicKey]]),
  now: () => NOW,
});

async function assertRejected(
  token: string,
  expectedReason: string
): Promise<void> {
  await assert.rejects(
    () => verifier.verify(token),
    (error: unknown) => {
      assert.ok(error instanceof IdTokenError);
      assert.equal(
        (error as IdTokenError).reason,
        expectedReason
      );
      return true;
    }
  );
}

test("rejects a token signed by an untrusted key", async () => {
  await assertRejected(
    signToken(
      { alg: "RS256", kid: "trusted-kid" },
      claims(),
      attacker.privateKey
    ),
    "bad_signature"
  );
});

test("rejects alg=none, which would skip signature checking entirely", async () => {
  await assertRejected(
    `${encode({ alg: "none", kid: "trusted-kid" })}.${encode(
      claims()
    )}.`,
    "bad_algorithm"
  );
});

test("rejects HS256 algorithm confusion", async () => {
  await assertRejected(
    `${encode({ alg: "HS256", kid: "trusted-kid" })}.${encode(
      claims()
    )}.AAAA`,
    "bad_algorithm"
  );
});

test("rejects an unknown or missing key identifier", async () => {
  await assertRejected(
    signToken(
      { alg: "RS256", kid: "attacker-kid" },
      claims(),
      attacker.privateKey
    ),
    "unknown_kid"
  );

  await assertRejected(
    signToken(
      { alg: "RS256" },
      claims(),
      trusted.privateKey
    ),
    "missing_kid"
  );
});

test("rejects a tampered payload, including a swapped subject", async () => {
  const parts = signToken(
    { alg: "RS256", kid: "trusted-kid" },
    claims(),
    trusted.privateKey
  ).split(".");

  parts[1] = encode(claims({ sub: "victim-uid" }));

  await assertRejected(
    parts.join("."),
    "bad_signature"
  );
});

test("validates issuer, audience, expiry, issued-at and subject", async () => {
  const cases: ReadonlyArray<
    readonly [Record<string, unknown>, string]
  > = [
    [{ iss: "https://evil.example.com" }, "bad_issuer"],
    [{ aud: "another-project" }, "bad_audience"],
    [{ exp: NOW - 3_600 }, "expired"],
    [{ iat: NOW + 9_999 }, "bad_issued_at"],
    [{ sub: "" }, "bad_subject"],
  ];

  for (const [overrides, reason] of cases) {
    await assertRejected(
      signToken(
        { alg: "RS256", kid: "trusted-kid" },
        claims(overrides),
        trusted.privateKey
      ),
      reason
    );
  }
});

test("rejects malformed input without throwing unexpected errors", async () => {
  await assertRejected("garbage", "malformed");
  await assertRejected("aaa.bbb", "malformed");
  await assertRejected("", "malformed");
  await assertRejected("x".repeat(9_000), "malformed");

  await assertRejected(
    `${Buffer.from("notjson").toString(
      "base64url"
    )}.${encode(claims())}.AA`,
    "malformed_header"
  );
});

test("accepts a legitimate token and resolves the identity", async () => {
  const identity = await verifier.verify(
    signToken(
      { alg: "RS256", kid: "trusted-kid" },
      claims(),
      trusted.privateKey
    )
  );

  assert.equal(identity.uid, "user-abc-123");
  assert.equal(identity.email, "user@example.com");
  assert.equal(identity.emailVerified, true);
});

test("tolerates small clock skew", async () => {
  const identity = await verifier.verify(
    signToken(
      { alg: "RS256", kid: "trusted-kid" },
      claims({ exp: NOW - 30 }),
      trusted.privateKey
    )
  );

  assert.equal(identity.uid, "user-abc-123");
});
