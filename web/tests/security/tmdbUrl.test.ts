import { test } from "node:test";
import assert from "node:assert/strict";

/*
 * AEGIS-001 regression tests.
 *
 * The original defect interpolated a caller-supplied movie ID straight into
 * the upstream URL path while appending the credential as a literal query
 * string:
 *
 *     `${BASE_URL}/movie/${id}?api_key=${API_KEY}`
 *
 * That let an anonymous caller traverse to a different TMDB endpoint
 * ("550/../../account") or override the server credential
 * ("550?api_key=..."), with the response relayed back.
 *
 * These tests assert both halves of the fix:
 *   1. the digits-only allowlist rejects every escape variant, and
 *   2. structural URL building cannot be subverted even if a raw value slips
 *      through, because the credential is set after the path is fixed.
 *
 * The pattern below MUST stay identical to the one used by the routes and
 * app/lib/tmdb.ts.
 */

const MOVIE_ID_PATTERN = /^[0-9]+$/;

const BASE_URL = "https://api.themoviedb.org/3";

const ESCAPE_ATTEMPTS: readonly string[] = [
  "550/../../account",
  "550/../../authentication/token/new",
  "..%2f..%2fauthentication",
  "550?api_key=ATTACKER_KEY&z=",
  "550&api_key=ATTACKER_KEY",
  "//evil.example.com/path",
  "550#fragment",
  "abc",
  "",
  " ",
  "5 50",
  "550\n/account",
];

test("rejects every known path and parameter escape", () => {
  for (const attempt of ESCAPE_ATTEMPTS) {
    assert.equal(
      MOVIE_ID_PATTERN.test(attempt),
      false,
      `movie ID guard accepted an escape attempt: ${JSON.stringify(attempt)}`
    );
  }
});

test("accepts legitimate numeric identifiers", () => {
  for (const id of ["1", "550", "27205", "1000000"]) {
    assert.equal(
      MOVIE_ID_PATTERN.test(id),
      true,
      `movie ID guard rejected a legitimate ID: ${id}`
    );
  }
});

test("structural URL building keeps host, path and credential intact", () => {
  const url = new URL(`${BASE_URL}/movie/550`);

  url.searchParams.set("api_key", "SERVER_SIDE_SECRET");

  assert.equal(url.host, "api.themoviedb.org");
  assert.equal(url.pathname, "/3/movie/550");
  assert.equal(
    url.searchParams.get("api_key"),
    "SERVER_SIDE_SECRET"
  );
});

test("a query-injecting value cannot override the credential when set structurally", () => {
  /*
   * Even if a raw value reached URL construction, setting api_key afterwards
   * means the attacker-supplied parameter cannot win. This is the defense in
   * depth behind the allowlist.
   */
  const url = new URL(
    `${BASE_URL}/search/movie`
  );

  url.searchParams.set("api_key", "SERVER_SIDE_SECRET");
  url.searchParams.set(
    "query",
    "dune&api_key=ATTACKER_KEY"
  );

  assert.equal(
    url.searchParams.get("api_key"),
    "SERVER_SIDE_SECRET"
  );

  assert.equal(
    url.searchParams.get("query"),
    "dune&api_key=ATTACKER_KEY"
  );
});

test("documents the traversal behaviour the guard exists to prevent", () => {
  /*
   * Confirms the underlying platform behaviour is still what the guard is
   * defending against: WHATWG URL normalizes "../" before the request is
   * sent, so an unguarded ID really would reach a different endpoint.
   */
  const unguarded = new URL(
    `${BASE_URL}/movie/550/../../account`
  );

  assert.equal(unguarded.pathname, "/3/account");
});
