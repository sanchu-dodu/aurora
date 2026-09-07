# CYBER-AEGIS Security Assessment — Aurora

**Engagement ID:** AEGIS-AURORA-001
**Assessed commit:** `aa6902c` (branch `arena/01a07c24-aurora`)
**Date:** 2026-09-07
**Authorization gate reached:** GATE 4 — REPOSITORY MODIFICATION (user approved 2026-09-07)
**Assessment type:** Static source, dependency, configuration, and CI review + approved remediation
**Status:** Remediation applied and independently verified on branch `arena/01a07c24-aurora`. Not deployed — Gate 5 (production) NOT authorized.

> **Remediation outcome:** AEGIS-001 through AEGIS-006 are CLOSED/VERIFIED. AEGIS-003 is PARTIALLY CLOSED (rate limiting shipped; server-side authentication deferred — see §8). AEGIS-007 and AEGIS-008 are CLOSED/VERIFIED. Verification evidence is in §8.

---

## 1. Scope

| Field | Value |
|---|---|
| IN_SCOPE | Local repository checkout at `/home/user/aurora` (`web/`, `aurora-cli/`, `.github/`, `firestore.rules`) |
| OUT_OF_SCOPE | Deployed Aurora environments, TMDB, YouTube, OpenAI, Firebase project `aurora-7b677`, npm registry, GitHub org infrastructure |
| ENVIRONMENT | Source repository (no running deployment assessed) |
| AUTHORIZED_TEST_TYPES | Read-only inspection, static analysis, dependency audit, local offline reproduction |
| PROHIBITED_TEST_TYPES | Any traffic to third-party services; DoS; production interaction |
| DATA_HANDLING | No real credentials accessed, stored, or transmitted |

**Third-party boundary enforced:** all reproduction was performed against a local mock HTTP listener on `127.0.0.1:8731`. No request was sent to `api.themoviedb.org` or any other external system.

---

## 2. Finding summary

| ID | Severity | Confidence | Title | Status |
|---|---|---|---|---|
| AEGIS-001 | **High** | High | TMDB URL path/parameter injection via unvalidated `id` | **CLOSED/VERIFIED** |
| AEGIS-002 | **Medium** | High | Unauthenticated proxy to internal Ollama service | **CLOSED/VERIFIED** |
| AEGIS-003 | **Medium** | High | No authentication or rate limiting on any API route | **PARTIALLY CLOSED** |
| AEGIS-004 | **Medium** | High | No security response headers or CSP | **CLOSED/VERIFIED** |
| AEGIS-005 | **Low** | High | Unhandled input type crash in `/api/ai` | **CLOSED/VERIFIED** |
| AEGIS-006 | **Low** | High | Known-vulnerable transitive dependencies | **CLOSED/VERIFIED** |
| AEGIS-007 | Informational | High | `/api/ai/movies` called but route does not exist | **CLOSED/VERIFIED** |
| AEGIS-008 | Informational | High | No server-side security logging | **CLOSED/VERIFIED** |

Counts — Critical: 0 · High: 1 · Medium: 3 · Low: 2 · Informational: 2

---

## 3. Findings

### AEGIS-001 — TMDB URL path and parameter injection via unvalidated `id`

- **AGENT:** A3 (Application & API Security)
- **ASSET:** Aurora web application
- **LOCATION:**
  - `web/app/api/movie/route.ts:16` — `` `${BASE_URL}/movie/${id}?api_key=${API_KEY}` ``
  - `web/app/api/trailer/route.ts:19` — same pattern
  - `web/app/lib/tmdb.ts` — `getMovieDetails`, `getMovieVideos`, `getSimilarMovies`, `getMovieTrailer`
- **STATUS:** REPRODUCED
- **SEVERITY:** High · **CONFIDENCE:** High
- **CATEGORY:** Improper neutralization of input in a URL
- **CWE:** CWE-20 (Improper Input Validation), CWE-88 (Argument Injection)
- **OWASP:** A03:2021 Injection · A01:2021 Broken Access Control
- **CVE:** N/A

**DESCRIPTION**
The `id` value is taken directly from the query string (`/api/movie?id=...`) or route params and interpolated into a TMDB URL without validation or encoding. Because `id` is placed in the *path* segment and the `api_key` is appended as a literal query string, an attacker controls both the path and the query parameters of a request that Aurora's server makes using its own secret `TMDB_API_TOKEN`. The upstream response is returned verbatim to the caller.

**EVIDENCE** — local reproduction against `127.0.0.1:8731` mock, replicating the exact template from `route.ts`:

```
benign         id="550"                         -> saw path: /3/movie/550   api_key: SERVER_SIDE_TMDB_SECRET
path-escape    id="550/../../account"           -> saw path: /3/account     api_key: SERVER_SIDE_TMDB_SECRET
key-override   id="550?api_key=ATTACKER_KEY&z=" -> saw path: /3/movie/550   api_key: ATTACKER_KEY
```

WHATWG URL normalization collapses `../` *before* the request is sent, so `/3/movie/550/../../account` is transmitted as `/3/account`.

**ATTACK PREREQUISITES:** None. Unauthenticated network access to the deployed app.

**ATTACK PATH**
`GET /api/movie?id=550/../../account` → server builds `https://api.themoviedb.org/3/account?api_key=<server token>` → TMDB responds → response body is returned to the attacker by `NextResponse.json(data)`.

**EXPLOITABILITY:** High — single crafted GET, no authentication, no special tooling.

**BOUNDED IMPACT (tested):** The hostname **cannot** be changed. `id=//evil.example.com/path` normalizes to `/3/movie///evil.example.com/path`, remaining on the TMDB host. This is therefore **not** full SSRF. Impact is confined to: arbitrary GET requests to any TMDB API v3 endpoint, authenticated as Aurora's TMDB account, with responses relayed to the attacker.

**POTENTIAL IMPACT:** Unauthorized use of Aurora's TMDB credential; disclosure of TMDB account data (`/3/account`, list contents) to anonymous users; quota consumption and potential TMDB terms-of-service violation attributed to Aurora.

**RECOMMENDED REMEDIATION (minimal, ~3 lines per route):** Validate `id` as digits-only before use.
```ts
if (!/^\d+$/.test(id)) {
  return NextResponse.json({ error: "Invalid movie ID" }, { status: 400 });
}
```
**ALTERNATIVE REMEDIATION:** Build the URL structurally so user input can never alter path or query:
```ts
const url = new URL(`${BASE_URL}/movie/${encodeURIComponent(id)}`);
url.searchParams.set("api_key", API_KEY);
```
Preferred long term: move the token to an `Authorization: Bearer` header so it can never be overridden by a query parameter.

**REGRESSION RISK:** Very low. TMDB movie IDs are integers; a digits-only guard rejects nothing legitimate.
**VERIFICATION METHOD:** Re-run the three-case harness; `path-escape` and `key-override` must return HTTP 400 and produce no upstream request.

---

### AEGIS-002 — Unauthenticated proxy to internal Ollama service

- **AGENT:** A3 / A4 · **LOCATION:** `web/app/api/ai/chat/route.ts`, `web/app/lib/ai/ollama.ts:3`
- **STATUS:** VERIFIED (static) · **SEVERITY:** Medium · **CONFIDENCE:** High
- **CWE:** CWE-284 (Improper Access Control), CWE-770 (Allocation Without Limits)
- **OWASP:** A01:2021 · LLM API risk (uncontrolled consumption)

**DESCRIPTION** `POST /api/ai/chat` accepts `body.messages` and `body.model` with no schema validation, no authentication, and no rate limit, and forwards them to `http://localhost:11434/api/chat`. The caller fully controls the conversation *and* the model name. `SYSTEM_PROMPTS` in `app/lib/prompts.ts` is defined but never applied on this path, so there is no server-side prompt grounding.

**EVIDENCE** `route.ts` performs `const body = await request.json()` then `chat("ollama", { messages: body.messages, model: body.model })` with no interposed checks. `grep` for `auth|session|Authorization` across all five API routes returns 0 matches.

**IMPACT** Where an Ollama instance is reachable from the app, anonymous users can run arbitrary inference on it (compute abuse, cost), load or probe arbitrary local models, and use Aurora as an unattributed LLM proxy. `body.messages` is unvalidated, so malformed input also reaches the upstream client.

**REMEDIATION** Require an authenticated session; validate `messages` with a schema (role enum + string content + length/count caps); pin the model server-side to an allowlist rather than accepting `body.model`; prepend `SYSTEM_PROMPTS.assistant`; apply per-user rate limiting.

**REGRESSION RISK:** Medium — requiring auth changes behavior for anonymous users; needs a product decision.

---

### AEGIS-003 — No authentication or rate limiting on any API route

- **AGENT:** A3 · **LOCATION:** all of `web/app/api/**/route.ts` · **SEVERITY:** Medium · **CONFIDENCE:** High
- **CWE:** CWE-306 (Missing Authentication for Critical Function), CWE-770

**EVIDENCE** All five routes (`ai`, `ai/chat`, `movie`, `search`, `trailer`) contain zero authentication or rate-limiting logic. No `middleware.ts` exists anywhere in `web/`. Client-side `ProtectedRoute.tsx` gates *pages* only — it provides no protection for API routes, which are directly reachable.

**IMPACT** Every backend capability is anonymously reachable and unmetered. This is the amplifier for AEGIS-001 and AEGIS-002.

**REMEDIATION** Verify the Firebase ID token server-side for routes that should be private, and apply rate limiting (edge middleware or a shared limiter) to all routes.

---

### AEGIS-004 — No security response headers or Content-Security-Policy

- **AGENT:** A7 (Defensive Security) · **LOCATION:** `web/next.config.ts` · **SEVERITY:** Medium · **CONFIDENCE:** High
- **CWE:** CWE-693 (Protection Mechanism Failure) · **OWASP:** A05:2021 Security Misconfiguration

**EVIDENCE** `next.config.ts` defines only `images.remotePatterns`. No `headers()` function, no `middleware.ts`. Absent: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `frame-ancestors`.

**MITIGATING CONTEXT** No XSS sink was found — `grep` for `dangerouslySetInnerHTML|innerHTML|eval(|srcdoc` across `web/` returned zero matches, and React escapes by default. CSP is therefore defense-in-depth here, not a fix for a known injection.

**REMEDIATION** Add a `headers()` block in `next.config.ts`. CSP requires care: the YouTube/`react-youtube` embed needs `frame-src https://www.youtube.com https://www.youtube-nocookie.com`, and images need `img-src https://image.tmdb.org`. Recommend `Content-Security-Policy-Report-Only` first to avoid breaking playback.

**REGRESSION RISK:** Medium for CSP (can break embeds if too strict); negligible for the other headers.

---

### AEGIS-005 — Unhandled input type crash in `/api/ai`

- **AGENT:** A3 · **LOCATION:** `web/app/api/ai/route.ts:4-6` · **SEVERITY:** Low · **CONFIDENCE:** High
- **CWE:** CWE-248 (Uncaught Exception), CWE-20

**EVIDENCE** `const { prompt } = await request.json(); const text = prompt.toLowerCase();` — no `try`/`catch` and no type check. A request with a missing, null, numeric, or non-string `prompt`, or a malformed JSON body, raises a `TypeError`/parse error and returns an unhandled HTTP 500.

**IMPACT** Low. Error-handling defect and noise; no data exposure. Note this route returns a static hardcoded list and calls no AI service.

**REMEDIATION** Wrap in `try`/`catch`; validate `typeof prompt === "string"` and return HTTP 400 otherwise.

---

### AEGIS-006 — Known-vulnerable transitive dependencies

- **AGENT:** A6 (Supply Chain) · **SEVERITY:** Low (contextual) · **CONFIDENCE:** High

**EVIDENCE** `npm audit`:

| Workspace | Package | Advisory | Direct? |
|---|---|---|---|
| `web/` | `brace-expansion` | GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 (DoS) | No — via `@typescript-eslint` |
| `web/` | `browserslist` | GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g | No — build chain |
| `aurora-cli/` | `nanoid` | GHSA-2v37-7h3g-55p8 | No |

**CONTEXTUAL SEVERITY** npm labels these "high," but all three are **transitive** and sit in the lint/build toolchain, not the runtime request path. They are DoS/resource-exhaustion classes requiring attacker-controlled input that does not reach them in this architecture. Downgraded from High to **Low** on exploitability grounds. All report `fixAvailable: true`.

**REMEDIATION** `npm audit fix` in each workspace; confirm the lockfile diff is limited to these packages.

---

### AEGIS-007 — `/api/ai/movies` is called but does not exist (Informational)

`web/app/ai/page.tsx:60` and `:78` fetch `/api/ai/movies`. `find app/api -name route.ts` lists only `ai`, `ai/chat`, `movie`, `search`, `trailer`. This resolves to a 404 at runtime — a functional defect surfaced during reconnaissance, not a vulnerability.

### AEGIS-008 — No server-side security logging (Informational)

`app/services/loggerService.ts` wraps `console.log`/`warn`/`error` for the browser only. There is no server-side request, authentication, or anomaly logging. Consequence: exploitation of AEGIS-001 or AEGIS-002 would leave **no detection trail**. Addresses NIST CSF **DE.AE** / **DE.CM** and CIS Control 8.

---

## 4. Attack path correlation (A8)

**PATH-1 — Anonymous resource and credential abuse**

```
AEGIS-003 (no auth, no rate limit)
   ├─> AEGIS-001 : arbitrary authenticated GETs to TMDB using Aurora's token, responses relayed
   └─> AEGIS-002 : unlimited inference on the internal Ollama instance
        + AEGIS-008 : no server-side logging -> abuse is silent and undetectable
```

Individually these rate as Medium. Combined, an unauthenticated internet user can operate the deployment as a free credential proxy and compute proxy with no throttle and no audit trail. **Combined risk: High.** The single highest-leverage control is authentication plus rate limiting at the API boundary (AEGIS-003), which constrains both branches at once.

---

## 5. Verified positive controls

These were tested and found sound. No action required.

- **Firestore rules** (`firestore.rules`) — deny-by-default catch-all `allow read, write: if false`, with owner-scoped `isOwner(userId)` on `/users/{userId}` and its subtree. Correctly constructed.
- **CLI cryptography** — Ed25519 signatures; strict SPKI canonicalization with round-trip verification (`packageSigningKey.ts`); domain-separated signing payload (`AURORA-PACKAGE-MANIFEST-SIGNATURE-V1\0`) preventing cross-protocol reuse; the `signature.value` field is correctly excluded from its own signed document.
- **Canonical JSON** (`packageCanonicalJson.ts`) — rejects non-`Object.prototype` prototypes (prototype-pollution resistant), symbol properties, getters, sparse arrays, unpaired UTF-16 surrogates, and cycles. Notably rigorous.
- **Process execution** — `spawn` is used with `shell: false` and `windowsHide: true` in all three call sites; no `shell: true` anywhere; no `eval`/`new Function`.
- **Path safety** — `ProjectPathBoundary` resolves with `fs.realpathSync.native`, rejects NUL bytes, and validates ancestors against symlink escape.
- **CI/CD** — all GitHub Actions are pinned to full commit SHAs (not tags); `permissions: contents: read` least-privilege; CodeQL with `security-extended`; Dependabot across all three ecosystems.
- **Secret hygiene** — repository-wide scan for committed credentials returned no hits; git history shows no `.env`, `.pem`, or key material ever added.

**Not a finding — Firebase client config.** The `apiKey` in `web/app/lib/firebase.ts` is a public client identifier, designed to ship in browser bundles. It is not a secret. Security is enforced by Firestore rules, which are correct. No rotation needed. Recorded explicitly so it is not mistaken for exposure by automated scanners.

---

## 6. Security debt register

| Category | Findings |
|---|---|
| **FIX NOW** | AEGIS-001 |
| **FIX NEXT** | AEGIS-003, AEGIS-002, AEGIS-004 |
| **PLANNED** | AEGIS-005, AEGIS-006, AEGIS-008 |
| **REQUIRES BUSINESS DECISION** | AEGIS-002 (should the AI endpoint be public at all?), AEGIS-007 (build the route or remove the call?) |
| **FALSE POSITIVE** | Firebase client `apiKey` |

---

## 7. Assurance statement and limitations

This assessment provides **moderate assurance over the source repository at commit `aa6902c` only**. It is not a statement that Aurora is secure.

Not covered:
- No deployed environment was tested; runtime behavior, hosting configuration, TLS, and WAF posture are **UNKNOWN — REQUIRES VALIDATION**.
- Firebase project IAM, App Check status, and Authentication provider settings were not inspected (out of scope; console access not provided).
- Rules in `firestore.rules` were reviewed statically and **not** executed against the Firestore emulator.
- No dynamic or authenticated application testing was performed (Gate 2 not authorized).
- Third-party services (TMDB, YouTube, npm, GitHub) were not contacted.
- `aurora-cli` review prioritized the trust, signing, execution, and path-boundary subsystems. The archive-extraction path was subsequently probed adversarially (see §10) and found sound; the remaining command surface still received only a lower-depth pass.

---

*Prepared by CYBER-AEGIS — Agents A1, A2, A3, A4, A6, A7, A8. Gate 1 (read-only). No system modified.*

---

## 8. Remediation record and independent verification (A9 → A10)

**Authorization:** user approved all findings, 2026-09-07. Gate 4 (repository modification) on branch `arena/01a07c24-aurora`. **Gate 5 (production deployment) was NOT granted and no deployment occurred.**

### CHANGE-001 — AEGIS-001 · TMDB URL injection

| Field | Value |
|---|---|
| Files | `web/app/api/movie/route.ts`, `web/app/api/trailer/route.ts`, `web/app/api/search/route.ts`, `web/app/lib/tmdb.ts` |
| Change | Digits-only allowlist on every movie ID; all upstream URLs built with `new URL()` + `searchParams.set()` so input cannot alter path or credential |
| Rollback | `git revert` the commit |

**A10 verification** — the patched route modules were loaded and driven with the original attack inputs, upstream redirected to a local recorder (no third-party traffic). A request reaching the recorder = failure.

```
PASS  movie/trailer  path traversal -> /3/account   status=400 upstreamReached=false
PASS  movie/trailer  api_key override              status=400 upstreamReached=false
PASS  movie/trailer  encoded traversal             status=400 upstreamReached=false
PASS  movie/trailer  host-ish prefix               status=400 upstreamReached=false
PASS  movie/trailer  alpha id / empty id           status=400 upstreamReached=false
PASS  REGRESSION     benign id=550 -> 200, path=/3/movie/550
RESULT: 13 passed, 0 failed
```

Confirmed again against the running dev server: `/api/movie?id=550%2F..%2F..%2Faccount` → `400 {"error":"Movie ID must be numeric"}`.

**Status: CLOSED/VERIFIED.**

### CHANGE-002 — AEGIS-002 / AEGIS-005 · AI route hardening

| Field | Value |
|---|---|
| Files | `web/app/api/ai/chat/route.ts`, `web/app/api/ai/route.ts`, `web/app/lib/ai/ollama.ts` |
| Change | Schema validation of `messages` (role enum, string content, count/size caps); **model pinned server-side** via allowlist; `SYSTEM_PROMPTS.assistant` prepended; upstream errors no longer leaked (502, detail logged server-side); 30s timeout + `AbortController`; upstream response shape validated; `OLLAMA_URL` made configurable |

**A10 verification** (upstream = local recorder on 11434):

```
PASS  malformed JSON / missing / non-array / empty messages   400, not forwarded
PASS  bad role / non-string content                           400, not forwarded
PASS  UNPINNED MODEL "llama3:70b" rejected                     400, not forwarded
PASS  oversized message / too many messages                   400, not forwarded
PASS  valid request                                            200, forwarded
PASS  system prompt grounding injected (first role = system)
PASS  model pinned server-side (qwen2.5-coder:3b)
PASS  rate limit triggers 429
RESULT: 13 passed, 0 failed
```

**Status: CLOSED/VERIFIED.**

### CHANGE-003 — AEGIS-003 · Rate limiting (PARTIAL)

Files: `web/app/lib/rateLimit.ts` (new) applied to all five routes — AI chat 10/min, `/api/ai` 30/min, movie & trailer 60/min, search 30/min. Verified returning HTTP 429 with `Retry-After`.

**Deliberately NOT done — server-side authentication.** Enforcing Firebase auth on API routes requires `firebase-admin` and a service-account credential that is not present in this environment. Implementing it unverified would have produced untested auth code — worse than none. **This finding therefore remains PARTIALLY CLOSED.** Residual risk: routes are still anonymously reachable, now throttled.

Also note the limiter is **per-process in-memory**: on serverless or multi-instance hosting the effective limit multiplies by instance count. It mitigates casual abuse, not a distributed attacker. Back it with shared storage (Vercel KV / Upstash) before relying on it in production.

### CHANGE-004 — AEGIS-004 · Security headers

File: `web/next.config.ts`. Added `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Strict-Transport-Security`, and a CSP.

**CSP ships as `Content-Security-Policy-Report-Only` by design** — Aurora embeds the YouTube player and Next.js injects inline bootstrap scripts, so an enforcing policy risked breaking playback. Collect violation reports, then rename the header to enforce. `'unsafe-inline'` on `script-src` remains until a nonce middleware is added; this is a known, accepted limitation of the Report-Only baseline, not an oversight.

All seven headers confirmed present on a live response. **Status: CLOSED/VERIFIED** (as a Report-Only baseline).

### CHANGE-005 — AEGIS-006 · Dependencies

`npm audit fix` in both workspaces. `web`: 0 vulnerabilities (was 2 high). `aurora-cli`: 0 vulnerabilities (was 1 high). **`package.json` unchanged in both — lockfile-only**, honoring the minimum-change principle.

### Regression testing

| Check | Result |
|---|---|
| `aurora-cli` full suite | **770/770 pass** (0 fail) — no regression from the nanoid bump |
| Web ESLint | Clean |
| Web `tsc --noEmit` | Clean |
| Web production compile | `✓ Compiled successfully`, TypeScript passed |
| Live header + attack check | All 7 headers present; all attack inputs 400 |

**Known environmental failure — not caused by these changes.** `npm run build` fails at prerender with `ECONNRESET` to `api.themoviedb.org`. This sandbox blocks outbound egress and the homepage prerenders live TMDB data. **Verified by stashing all changes and rebuilding the unmodified baseline, which fails identically.** CI has network access and a real token, so this will not reproduce there. Playwright E2E was likewise not runnable for the same reason.

### Residual risk

1. **API routes remain unauthenticated** (throttled only) — AEGIS-003 partial.
2. **Rate limiter is per-instance** — weak under horizontal scaling.
3. **CSP is Report-Only** — no enforcement until promoted.
4. ~~No server-side security logging~~ — **resolved, see CHANGE-006.** Remaining gap: logs are emitted but nothing *alerts* on them. Wire `event:"rate_limit_exceeded"` and `finding:"AEGIS-001"` to your monitoring platform to gain detection rather than just forensics.
5. **E2E and full build unverified in-sandbox** — must pass in CI before merge.
6. **AEGIS-007 open:** `web/app/ai/page.tsx` contains a debug short-circuit (`console.log(await aiRes.text()); return;` at line ~33) that makes the rest of `askAurora()`, including the `/api/ai/movies` calls, unreachable dead code. Left untouched: removing it changes product behavior and would expose the missing route. **Requires your decision.**

### Recommended next actions

1. Let CI run on this branch (real network + token) to confirm build and E2E.
2. Decide on AEGIS-007: build `/api/ai/movies`, or remove the dead code.
3. Decide whether `/api/ai/chat` should be public; if not, add `firebase-admin` token verification.
4. Promote CSP from Report-Only after reviewing reports.
5. Move rate limiting to shared storage before production scale.

---

## 9. CHANGE-006 — AEGIS-008 · Server-side security logging

**Authorization:** user approved, 2026-09-07. Gate 4. Purely additive — no existing control altered.

| Field | Value |
|---|---|
| Files | `web/app/lib/securityLog.ts` (new); wired into all five API routes |
| Change | Structured single-line JSON security events on every rejection path: `input_validation_failed`, `rate_limit_exceeded`, `malformed_request`, `upstream_failure` |
| Framework | NIST CSF DE.AE-3, DE.CM-1 · CIS Control 8 |
| Rollback | `git revert` |

Closes the detection gap identified in PATH-1: exploitation of AEGIS-001 or AEGIS-002 previously left **no audit trail**. Each event carries the responsible finding ID, so an alert maps straight back to this report.

**Privacy and secret-safety by construction:**
- Values pass through a redactor modelled on the patterns already proven in `aurora-cli/src/security/secretRedactor.ts` (consistent scrubbing across web and CLI).
- Full request URLs, request bodies, and AI prompt content are **never** logged — only a rejection reason.
- Client IPs are truncated (`203.0.113.45` → `203.0.x.x`), keeping events correlatable without retaining a full identifier.
- Fields are length-bounded so a large input cannot flood the log stream.
- Every call is wrapped so a broken log sink can never break a request.

**A10 verification — 16/16 passed:**

```
SECRET REDACTION   tmdb api_key / bearer / github PAT / JWT / password / userinfo URL  -> all [REDACTED]
DETECTION VALUE    traversal payload "550/../../account" preserved
FLOOD BOUNDED      5000-char field truncated to 214
PRIVACY            ipv4 -> 203.0.x.x   ipv6 -> 2001:db8::/32
STRUCTURE          valid single-line JSON; event/route/outcome/finding present
RESILIENCE         survives a broken log sink without throwing
```

**End-to-end confirmation** against the running server — attack traffic produced this trail:

```json
{"event":"input_validation_failed","route":"/api/movie","reason":"non_numeric_movie_id","detail":"550/../../account","finding":"AEGIS-001","client":"127.0.x.x"}
{"event":"input_validation_failed","route":"/api/trailer","detail":"550?api_key=[REDACTED]","finding":"AEGIS-001","client":"127.0.x.x"}
{"event":"input_validation_failed","route":"/api/ai/chat","reason":"The requested model is not available.","finding":"AEGIS-002","client":"127.0.x.x"}
{"event":"rate_limit_exceeded","route":"/api/ai/chat","finding":"AEGIS-003","client":"127.0.x.x"}
```

Note the second entry: the injected `api_key` value was scrubbed while the **attack shape was preserved**. Defenders see the attempt; the secret never reaches disk.

**Regression:** AEGIS-001 harness re-run **13/13 pass**; web lint, `tsc --noEmit`, and production compile all clean.

**Status: CLOSED/VERIFIED.**

### Updated residual risk

- Logs are emitted but **nothing alerts on them yet**. Route `rate_limit_exceeded` and `finding:"AEGIS-001"` events into your monitoring platform to convert forensics into detection.
- AEGIS-003 remains PARTIAL (no server-side auth) and AEGIS-007 remains OPEN — both still need your decisions.

---

## 10. CHANGE-007 — AEGIS-007 · Missing route implemented + adversarial re-review

**Authorization:** user approved, 2026-09-07. Gate 4.

### AEGIS-007 resolution

`web/app/ai/page.tsx` contained a debug short-circuit (`console.log(await aiRes.text()); return;`) that made the remainder of `askAurora()` unreachable — which is why the missing `/api/ai/movies` route never surfaced as a visible failure. Two defects, one cause.

Both are now resolved: the short-circuit was removed (a 2-line deletion, no other page logic touched) and `web/app/api/ai/movies/route.ts` was implemented. Deleting the short-circuit alone would have exposed a live 404 on a working page, so the route was required to avoid regressing the user experience.

The new route was built with the controls established elsewhere in this assessment rather than as a bare implementation:

- `titles` validated as an array; non-string, empty, and oversized entries filtered.
- **Fan-out bounded to 10 titles.** Each accepted request triggers one upstream TMDB lookup per title, so an unbounded array would convert a single request into unlimited upstream traffic charged to Aurora's credential — the same class of abuse as AEGIS-001. Rate limit set to 20/min, tighter than the 1:1 proxy routes.
- Response projected to only the five fields the client renders, so upstream payload fields are not relayed.
- Duplicate results collapsed.
- Rate limiting and AEGIS-008 security logging wired in.

**A10 verification — 13/13 passed:**

```
PASS  malformed JSON / missing titles / titles not array   -> 400
PASS  500-title fan-out rejected -> 400   upstreamCalls=0
PASS  no upstream traffic on rejection
PASS  valid request -> 200, fan-out bounded to input size (2 titles = 2 calls)
PASS  no upstream field leakage (unrequested fields stripped)
PASS  only whitelisted fields returned
PASS  duplicate results collapsed
PASS  oversized title filtered out
PASS  rate limit triggers 429
```

Confirmed live: `POST /api/ai/movies` returns **200** (previously 404), the 500-title payload is rejected **400 with zero upstream calls**, and `GET /ai` renders 200.

**Status: CLOSED/VERIFIED.**

### Loop C — adversarial re-review of the CLI extraction surface

§7 acknowledged that the broader `aurora-cli` surface received only a lower-depth pass. The highest-risk unreviewed component was archive extraction, where a malicious package artifact could attempt to write outside the staging directory.

Two controls were examined and then probed:

1. **Entry-type allowlist** (`officialRegistryArtifactExtractor.ts`) — only regular files (type `0`/`0x30`) and directories (`0x35`) are accepted. Symlink, hardlink, device, and PAX extension entries are rejected outright, eliminating the symlink-escape class entirely.
2. **Path canonicalization** (`canonicalArchivePath`) — rejects absolute paths, `..`, `.`, empty segments, backslashes, NUL and control characters, colons, Windows reserved device names, and trailing dot/space.

The guard logic was replicated exactly and driven with 15 adversarial archive paths:

```
BLOCKED  classic traversal, nested traversal, absolute unix, windows backslash,
         windows drive, UNC path, NUL byte, empty segment, single dot,
         trailing space, trailing dot, reserved device, reserved device ext,
         control char, oversized
RESULT: 15/15 attacks blocked, 0 leaked; 4/4 benign paths accepted
```

**No new finding.** The extraction surface is sound, and the guard produces no false rejections on legitimate paths. Recorded as a verified positive control.

### Regression

| Check | Result |
|---|---|
| AEGIS-001 harness | 13/13 pass |
| AEGIS-002 harness | 13/13 pass |
| AEGIS-008 harness | 16/16 pass |
| AEGIS-007 harness | 13/13 pass |
| Web lint / `tsc --noEmit` / compile | Clean |
| Live: headers, traversal block, `/ai` render | 7/7 headers, 400, 200 |

### Final residual risk

1. **AEGIS-003 remains PARTIAL** — API routes are throttled but still unauthenticated. Requires `firebase-admin` and a service-account credential. **The only finding not fully closed.**
2. **Rate limiting is per-process** — multiply the limit by instance count on scaled deployments.
3. **CSP is Report-Only** — promote after reviewing violation reports.
4. **Logs are emitted but unalerted** — route them to monitoring to gain detection.
5. **Build and E2E unverified in-sandbox** (TMDB egress blocked; baseline fails identically) — must pass in CI.
6. **`aurora-cli` command surface** outside trust, signing, execution, path-boundary, and extraction remains lower-depth reviewed.
