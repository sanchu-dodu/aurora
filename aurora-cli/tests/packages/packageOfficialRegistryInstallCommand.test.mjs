import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { installActiveOfficialRegistryPackage as install } from "../../dist/packages/registry/officialRegistryInstallCommand.js";
import { activateOfficialRegistryRelease } from "../../dist/packages/registry/officialRegistryReleaseActivationCommand.js";
import { OfficialRegistryArtifactCache } from "../../dist/packages/registry/officialRegistryArtifactCache.js";
import { OfficialRegistryVerifier } from "../../dist/packages/registry/officialRegistryVerifier.js";
import { compareOfficialRegistryPackageEntries } from "../../dist/packages/registry/officialRegistrySchema.js";
import { createOfficialRegistrySigningPayload } from "../../dist/packages/registry/officialRegistrySigningPayload.js";
import { createPackageSigningPayload } from "../../dist/packages/trust/packageSigningPayload.js";
import { encodeEd25519PublicKeySpki, fingerprintEd25519PublicKey } from "../../dist/packages/trust/packageSigningKey.js";
import { AURORA_OFFICIAL_PUBLISHER_ID } from "../../dist/packages/trust/officialPublisherTrust.js";
import { PackageTrustStore } from "../../dist/packages/trust/packageTrustStore.js";
import { canonicalizeJson } from "../../dist/packages/trust/packageCanonicalJson.js";
import { calculateArtifactDigest } from "../../dist/packages/integrity/packageArtifactVerifier.js";
import { LockManager } from "../../dist/packages/lock/lockManager.js";
import { InstalledStateVerifier } from "../../dist/packages/verify/installedStateVerifier.js";
import { ProjectLifecycleLock } from "../../dist/packages/lifecycle/projectLifecycleLock.js";
import { DurableFileTransaction } from "../../dist/packages/lifecycle/durableFileTransaction.js";
import { createManifestV1 } from "./manifestTestUtils.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const dependency = (id, version = "^1.0.0", optional = false) => ({ id, version, optional });
const absent = path => assert.rejects(fs.access(path), { code: "ENOENT" });

function archive(entries) {
  const parts = [];
  for (const [name, bytes] of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, "ascii");
    for (const [offset, length, value] of [[100, 8, 0o600], [108, 8, 0], [116, 8, 0], [124, 12, bytes.length], [136, 12, 0]]) {
      header.write(value.toString(8).padStart(length - 1, "0"), offset, "ascii");
    }
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write("ustar", 257, "ascii");
    header.write("00", 263, "ascii");
    header.write(header.reduce((sum, value) => sum + value, 0).toString(8).padStart(6, "0"), 148, "ascii");
    header[154] = 0;
    header[155] = 32;
    parts.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

function packaged(authority, spec) {
  const { id = "alpha", version = "1.0.0", dependencies = [], unsigned = false, revoked = false, installer, overrides = {} } = spec;
  const content = Buffer.from(installer ?? `${id}@${version}\n`);
  const path = installer ? "install.js" : `templates/${id}.txt.template`;
  const files = [{ path, role: installer ? "installer" : "template", digest: sha256(content) }];
  const manifest = createManifestV1({
    id, version, dependencies, files,
    publisher: { id: AURORA_OFFICIAL_PUBLISHER_ID, name: "Test authority", url: "https://example.com/aurora-tests" },
    capabilities: installer ? ["package.code.execute", "project.files.write"] : ["project.files.write"],
    artifact: { algorithm: "sha256", digest: calculateArtifactDigest(files) },
    ...overrides,
  });
  if (!unsigned) {
    manifest.signature = { version: 1, algorithm: "ed25519", keyId: authority.keyId, value: "" };
    manifest.signature.value = sign(null, createPackageSigningPayload(manifest), authority.privateKey).toString("base64url");
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const bytes = archive([["manifest.json", manifestBytes], [path, content]]);
  return {
    bytes, manifest,
    entry: {
      packageId: id, version, manifestDigest: sha256(manifestBytes),
      archive: { algorithm: "sha256", digest: sha256(bytes), size: bytes.length, url: `https://registry.aurora.example/packages/${id}/${version}.tgz` },
      provenance: { type: "build", url: "https://github.com/sanchu-dodu/aurora", reference: `${id}@${version}` },
      lifecycle: revoked ? { status: "revoked", reason: "Test revocation" } : { status: "active" },
    },
  };
}

async function fixture(context, specs = [{}]) {
  const root = await fs.mkdtemp(join(tmpdir(), "aurora-command-install-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  const temporaryRoot = join(root, "temporary");
  await fs.mkdir(project);
  await fs.mkdir(temporaryRoot);
  await fs.writeFile(join(project, "package.json"), JSON.stringify({ name: "test-project", version: "1.0.0", private: true, dependencies: {} }));
  const keys = generateKeyPairSync("ed25519");
  const authority = { ...keys, keyId: fingerprintEd25519PublicKey(keys.publicKey) };
  const publishers = [{ id: AURORA_OFFICIAL_PUBLISHER_ID, status: "trusted", keys: [{ algorithm: "ed25519", publicKey: encodeEd25519PublicKeySpki(keys.publicKey), status: "trusted" }] }];
  const verifierOptions = { trustStore: new PackageTrustStore(publishers) };
  const packages = specs.map(spec => packaged(authority, spec));
  function snapshot(sequence, previousSnapshotDigest, entries) {
    const candidate = {
      registryVersion: 1, kind: "aurora-official-package-registry", sequence,
      publishedAt: `2026-08-2${sequence}T12:00:00.000Z`, previousSnapshotDigest,
      publisherId: AURORA_OFFICIAL_PUBLISHER_ID,
      packages: [...entries].sort(compareOfficialRegistryPackageEntries),
      signature: { version: 1, algorithm: "ed25519", keyId: authority.keyId, value: "" },
    };
    candidate.signature.value = sign(null, createOfficialRegistrySigningPayload(candidate), authority.privateKey).toString("base64url");
    return candidate;
  }
  const verifier = new OfficialRegistryVerifier(verifierOptions);
  const genesis = snapshot(1, null, []);
  const previous = verifier.verify(genesis);
  const current = snapshot(2, previous.digest, packages.map(item => item.entry));
  const verified = verifier.verify(current, previous);
  const history = join(project, "history.json");
  const release = join(project, "release");
  await fs.mkdir(release);
  await fs.writeFile(history, JSON.stringify([genesis]));
  await fs.writeFile(join(release, "snapshot.json"), `${canonicalizeJson(current)}\n`);
  const activated = await activateOfficialRegistryRelease(release, { registryHistory: history }, { workspaceRoot: project, registryVerifierOptions: verifierOptions });
  const requests = [];
  const lookups = [];
  const deps = {
    workspaceRoot: project, temporaryRoot, registryVerifierOptions: verifierOptions,
    trust: { trustedPublishers: publishers },
    addressResolver: { async lookup(host) { lookups.push(host); return [{ address: "93.184.216.34", family: 4 }]; } },
    transport: {
      async request(input) {
        requests.push(input.path);
        const selected = packages.find(item => new URL(item.entry.archive.url).pathname === input.path);
        assert.ok(selected);
        input.onResponseHead(200, [{ name: "Content-Length", value: String(selected.bytes.length) }]);
        await input.onBodyChunk(selected.bytes);
      },
    },
  };
  return {
    root, project, temporaryRoot, packages, requests, lookups, deps, activated,
    options: { registryDigest: verified.digest },
    manager: new LockManager(project),
    cache() { return new OfficialRegistryArtifactCache(current, join(project, ".aurora/official-artifacts"), { registryOptions: { previous, verifierOptions } }); },
    async clean() { assert.deepEqual(await fs.readdir(temporaryRoot), []); },
  };
}

test("official install command installs a signed dependency set and preserves full locks", async t => {
  const f = await fixture(t, [{ dependencies: [dependency("beta")] }, { id: "beta" }]);
  await install("alpha", f.options, f.deps);
  const locks = await f.manager.read();
  assert.deepEqual(Object.keys(locks.packages), ["alpha", "beta"]);
  for (const id of ["alpha", "beta"]) {
    assert.equal(await fs.readFile(join(f.project, "src", `${id}.txt`), "utf8"), `${id}@1.0.0\n`);
    assert.equal(locks.packages[id].registry.digest, f.options.registryDigest);
    assert.ok(locks.packages[id].publisher.signatureKeyId);
    await new InstalledStateVerifier().verify(id, f.project);
  }
  assert.equal(f.requests.length, 2);
  const original = await fs.readFile(join(f.project, "aurora.lock"), "utf8");
  await install("alpha", f.options, f.deps);
  assert.equal(f.requests.length, 2);
  assert.equal(await fs.readFile(join(f.project, "aurora.lock"), "utf8"), original);
  await f.clean();
});

test("official install reproduces a locked dependency set in a fresh workspace without network", async t => {
  const f = await fixture(t, [{ dependencies: [dependency("beta")] }, { id: "beta" }]);
  await install("alpha", f.options, f.deps);
  const clone = join(f.root, "offline");
  await fs.mkdir(clone);
  for (const relative of ["package.json", "aurora.lock", ".aurora/official-registry", ".aurora/official-artifacts"]) {
    await fs.cp(join(f.project, relative), join(clone, relative), { recursive: true });
  }
  const offlineDeps = { ...f.deps, workspaceRoot: clone,
    addressResolver: { async lookup() { assert.fail("offline DNS"); } },
    transport: { async request() { assert.fail("offline transport"); } },
  };
  await install("alpha", { ...f.options, offline: true }, offlineDeps);
  for (const id of ["alpha", "beta"]) {
    assert.equal(await fs.readFile(join(clone, "src", `${id}.txt`), "utf8"), `${id}@1.0.0\n`);
    await new InstalledStateVerifier().verify(id, clone);
  }
  assert.deepEqual(await fs.readFile(join(clone, "aurora.lock")), await fs.readFile(join(f.project, "aurora.lock")));
  await f.clean();
});

for (const [name, options, pattern] of [
  ["missing pin", {}, /registry-digest/],
  ["invalid pin", { registryDigest: "NOT-A-DIGEST" }, /registry-digest/],
  ["wrong pin", { registryDigest: "f".repeat(64) }, /digest|pin/],
  ["both selectors", { version: "1.0.0", range: "^1.0.0" }, /either/],
  ["invalid exact version", { version: "banana" }, /semantic/],
  ["invalid range", { range: "banana" }, /range/],
  ["offline selector", { offline: true, version: "1.0.0" }, /offline/],
  ["invalid offline flag", { offline: "true" }, /boolean/],
]) {
  test(`official install refuses ${name} before artifact I/O`, async t => {
    const f = await fixture(t);
    await assert.rejects(install("alpha", name === "missing pin" ? options : { ...f.options, ...options }, f.deps), pattern);
    assert.equal(f.lookups.length, 0);
    await absent(join(f.project, ".aurora/official-artifacts"));
    await absent(join(f.project, "aurora.lock"));
    await f.clean();
  });
}

for (const [name, specs, pattern] of [
  ["unsigned package", [{ unsigned: true }], /sign/i],
  ["revoked package", [{ revoked: true }], /revoked|active/i],
  ["dependency cycle", [{ dependencies: [dependency("beta")] }, { id: "beta", dependencies: [dependency("alpha")] }], /cycle/],
  ["missing dependency", [{ dependencies: [dependency("missing")] }], /missing|active|found/i],
  ["conflicting dependency ranges", [{ dependencies: [dependency("beta"), dependency("gamma")] }, { id: "beta", dependencies: [dependency("delta", "^1.0.0")] }, { id: "gamma", dependencies: [dependency("delta", "^2.0.0")] }, { id: "delta" }, { id: "delta", version: "2.0.0" }], /conflict/],
  ["incompatible platform", [{ overrides: { compatibility: { aurora: ">=99.0.0", node: ">=22.0.0" } } }], /compatib|requires/i],
]) {
  test(`official install refuses ${name} without publishing a partial lock`, async t => {
    const f = await fixture(t, specs);
    await assert.rejects(install("alpha", f.options, f.deps), pattern);
    await absent(join(f.project, "aurora.lock"));
    await absent(join(f.project, "src/alpha.txt"));
    await f.clean();
  });
}

test("official install skips absent optional dependencies", async t => {
  const f = await fixture(t, [{ dependencies: [dependency("missing", "^1.0.0", true)] }]);
  await install("alpha", f.options, f.deps);
  assert.deepEqual(Object.keys((await f.manager.read()).packages), ["alpha"]);
  assert.equal(f.requests.length, 1);
  await f.clean();
});

test("official install selects a range and never silently upgrades an existing lock", async t => {
  const f = await fixture(t, [{}, { version: "1.5.0" }, { version: "2.0.0" }]);
  await install("alpha", { ...f.options, range: "^1.0.0" }, f.deps);
  assert.equal((await f.manager.read()).packages.alpha.version, "1.5.0");
  await install("alpha", f.options, f.deps);
  await assert.rejects(install("alpha", { ...f.options, version: "2.0.0" }, f.deps), /existing lock/);
  assert.equal((await f.manager.read()).packages.alpha.version, "1.5.0");
  assert.equal(f.requests.length, 1);
  await f.clean();
});

test("official install refuses legacy locks and offline missing locks before network", async t => {
  const f = await fixture(t);
  await assert.rejects(install("alpha", { ...f.options, offline: true }, f.deps), /full official-registry lock/);
  await f.manager.register("alpha", "1.0.0");
  const original = await fs.readFile(join(f.project, "aurora.lock"));
  await assert.rejects(install("alpha", f.options, f.deps), /full official-registry lock/);
  assert.deepEqual(await fs.readFile(join(f.project, "aurora.lock")), original);
  assert.equal(f.lookups.length, 0);
});

test("official install rejects altered downloaded bytes and removes quarantine", async t => {
  const f = await fixture(t);
  const transport = { async request(input) {
    const bytes = Buffer.from(f.packages[0].bytes);
    bytes[bytes.length - 1] ^= 1;
    input.onResponseHead(200, []);
    await input.onBodyChunk(bytes);
  } };
  await assert.rejects(install("alpha", f.options, { ...f.deps, transport }), /digest|integrity/i);
  await absent(join(f.project, "aurora.lock"));
  await f.clean();
});

test("official install refuses a corrupted present cache without a download fallback", async t => {
  const f = await fixture(t);
  await install("alpha", f.options, f.deps);
  const cached = await f.cache().get("alpha", { kind: "exact", version: "1.0.0" });
  await fs.writeFile(cached.filePath, "corrupt");
  await assert.rejects(install("alpha", f.options, f.deps), /cache|integrity/i);
  assert.equal(f.requests.length, 1);
  await f.clean();
});

test("official install refuses changed lock identity and leaves the original bytes intact", async t => {
  const f = await fixture(t);
  await install("alpha", f.options, f.deps);
  const lock = await f.manager.read();
  lock.packages.alpha.publisher.id = "other-publisher";
  await f.manager.write(lock);
  const original = await fs.readFile(join(f.project, "aurora.lock"));
  await assert.rejects(install("alpha", f.options, f.deps), /replace|lock/);
  assert.deepEqual(await fs.readFile(join(f.project, "aurora.lock")), original);
  assert.equal(f.requests.length, 1);
  await f.clean();
});

test("official install rejects a concurrent lock change instead of overwriting it", async t => {
  const f = await fixture(t);
  const originalTransport = f.deps.transport;
  f.deps.transport = { async request(input) {
    await originalTransport.request(input);
    await f.manager.register("unrelated", "1.0.0");
  } };
  await assert.rejects(install("alpha", f.options, f.deps), /changed while/);
  assert.deepEqual(Object.keys((await f.manager.read()).packages), ["unrelated"]);
  await absent(join(f.project, "src/alpha.txt"));
  await f.clean();
});

test("official install reauthenticates active state after download before publishing locks", async t => {
  const f = await fixture(t);
  const originalTransport = f.deps.transport;
  f.deps.transport = { async request(input) {
    await originalTransport.request(input);
    await fs.writeFile(join(f.project, ".aurora/official-registry/current.json"), "{}");
  } };
  await assert.rejects(install("alpha", f.options, f.deps));
  await absent(join(f.project, "aurora.lock"));
  await absent(join(f.project, "src/alpha.txt"));
  await f.clean();
});

test("official install does not publish a plan while another lifecycle operation owns the project", async t => {
  const f = await fixture(t);
  const held = await ProjectLifecycleLock.acquire(f.project);
  try {
    await assert.rejects(install("alpha", f.options, f.deps), /lock|lifecycle/i);
    await absent(join(f.project, "aurora.lock"));
  } finally {
    await held.release();
  }
  await f.clean();
});

test("official lock-set publication is atomic on conflicts and rejects duplicate identities", async t => {
  const f = await fixture(t, [{ dependencies: [dependency("beta")] }, { id: "beta" }]);
  await install("alpha", f.options, f.deps);
  const entries = Object.values((await f.manager.read()).packages);
  await f.manager.write({ packages: { beta: "1.0.0" } });
  const original = await fs.readFile(join(f.project, "aurora.lock"));
  await assert.rejects(f.manager.registerMissingOfficialSet(entries, await f.manager.read()), /replace/);
  assert.deepEqual(await fs.readFile(join(f.project, "aurora.lock")), original);
  await assert.rejects(f.manager.registerMissingOfficialSet([entries[0], entries[0]], await f.manager.read()), /unique/);
  await assert.rejects(f.manager.registerMissingOfficialSet([], await f.manager.read()), /unique/);
});

test("official install requires publisher trust and cannot use unsigned compatibility", async t => {
  const f = await fixture(t, [{ unsigned: true }]);
  await assert.rejects(install("alpha", f.options, { ...f.deps, trust: { ...f.deps.trust, requireSignatures: false } }), /sign/i);
  await absent(join(f.project, "aurora.lock"));
  await f.clean();
  const signed = await fixture(t);
  await assert.rejects(install("alpha", signed.options, { ...signed.deps, trust: { trustedPublishers: [] } }), /trust|publisher/i);
  await absent(join(signed.project, "aurora.lock"));
  await signed.clean();
});

test("official install rejects a revoked required dependency without project mutation", async t => {
  const f = await fixture(t, [{ dependencies: [dependency("beta")] }, { id: "beta", revoked: true }]);
  await assert.rejects(install("alpha", f.options, f.deps), /revoked|active/i);
  await absent(join(f.project, "aurora.lock"));
  await absent(join(f.project, "src"));
  assert.equal(f.requests.length, 1);
  await f.clean();
});

test("official install rejects redirected responses without a partial lock or staging leak", async t => {
  const f = await fixture(t);
  await assert.rejects(install("alpha", f.options, { ...f.deps, transport: {
    async request(input) { input.onResponseHead(302, [{ name: "Location", value: "https://elsewhere.example/archive" }]); },
  } }), /redirect|HTTP|status/i);
  await absent(join(f.project, "aurora.lock"));
  await f.clean();
});

test("official install fails closed when an existing offline dependency archive is missing", async t => {
  const f = await fixture(t, [{ dependencies: [dependency("beta")] }, { id: "beta" }]);
  await install("alpha", f.options, f.deps);
  const cached = await f.cache().get("beta", { kind: "exact", version: "1.0.0" });
  await fs.unlink(cached.filePath);
  await assert.rejects(install("alpha", { ...f.options, offline: true }, f.deps), /offline cache.*beta|beta.*cache/i);
  assert.equal(f.requests.length, 2);
  await f.clean();
});

test("official install fails closed when an offline dependency lock is missing", async t => {
  const f = await fixture(t, [{ dependencies: [dependency("beta")] }, { id: "beta" }]);
  await install("alpha", f.options, f.deps);
  const lock = await f.manager.read();
  delete lock.packages.beta;
  await f.manager.write(lock);
  await assert.rejects(install("alpha", { ...f.options, offline: true }, f.deps), /beta.*full official-registry lock/);
  assert.equal(f.requests.length, 2);
  assert.equal((await f.manager.read()).packages.beta, undefined);
  await f.clean();
});

test("official install reports an absent offline cache without recreating it", async t => {
  const f = await fixture(t);
  await install("alpha", f.options, f.deps);
  await fs.rename(join(f.project, ".aurora/official-artifacts"), join(f.root, "saved-cache"));
  await assert.rejects(install("alpha", { ...f.options, offline: true }, f.deps), /offline artifact cache is missing/);
  await absent(join(f.project, ".aurora/official-artifacts"));
  assert.equal(f.requests.length, 1);
});

test("official install refuses a cache junction and preserves the outside directory", async t => {
  const f = await fixture(t);
  const outside = join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(join(outside, "sentinel"), "untouched");
  await fs.symlink(outside, join(f.project, ".aurora/official-artifacts"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(install("alpha", f.options, f.deps), /symbolic|junction|unsafe/i);
  assert.equal(await fs.readFile(join(outside, "sentinel"), "utf8"), "untouched");
  assert.equal(f.lookups.length, 0);
  await absent(join(f.project, "aurora.lock"));
  await f.clean();
});

test("official install rolls back executable failure while retaining the authenticated retry lock", async t => {
  const f = await fixture(t, [{ dependencies: [dependency("beta")], installer: `
export async function install(context) {
  await context.createFile("created/by-installer.txt", "temporary");
  throw new Error("official-command-rollback-test");
}` }, { id: "beta" }]);
  await assert.rejects(install("alpha", f.options, f.deps), /official-command-rollback-test/);
  await absent(join(f.project, "created"));
  await absent(join(f.project, "src"));
  await absent(join(f.project, ".aurora/cache.json"));
  assert.deepEqual(Object.keys((await f.manager.read()).packages), ["alpha", "beta"]);
  await f.clean();
});

test("official install bounds the dependency graph before publishing any lock", async t => {
  const specs = Array.from({ length: 65 }, (_, index) => ({
    id: `item-${String(index).padStart(2, "0")}`,
    dependencies: index === 64 ? [] : [dependency(`item-${String(index + 1).padStart(2, "0")}`)],
  }));
  const f = await fixture(t, specs);
  await assert.rejects(install("item-00", f.options, f.deps), /bounded installation budget/);
  assert.equal(f.requests.length, 64);
  await absent(join(f.project, "aurora.lock"));
  await absent(join(f.project, "src"));
  await f.clean();
});

test("offline installation denies package network grants even for a trusted embedding caller", async t => {
  const f = await fixture(t, [{ overrides: {
    capabilities: ["project.files.write", "network.access"],
    networkAccess: [{ origin: "https://api.example.com", methods: ["GET"] }],
  } }]);
  f.deps.executionPolicy = { packageNetworkGrants: [{
    publisherId: AURORA_OFFICIAL_PUBLISHER_ID, packageId: "alpha", origin: "https://api.example.com", methods: ["GET"],
  }] };
  await install("alpha", f.options, f.deps);
  const original = await fs.readFile(join(f.project, "aurora.lock"));
  await assert.rejects(install("alpha", { ...f.options, offline: true }, f.deps), /network.*grant|network.*policy/i);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(await fs.readFile(join(f.project, "aurora.lock")), original);
  await f.clean();
});

test("official install includes an optional dependency when its full lock already exists", async t => {
  const f = await fixture(t, [{ dependencies: [dependency("beta", "^1.0.0", true)] }, { id: "beta" }]);
  await install("beta", f.options, f.deps);
  const beta = (await f.manager.read()).packages.beta;
  await install("alpha", f.options, f.deps);
  const locks = await f.manager.read();
  assert.deepEqual(Object.keys(locks.packages), ["alpha", "beta"]);
  assert.deepEqual(locks.packages.beta, beta);
  assert.equal(f.requests.length, 2);
  await f.clean();
});

test("official install recovers interrupted lock mutation and refuses the stale plan", async t => {
  const f = await fixture(t);
  const held = await ProjectLifecycleLock.acquire(f.project);
  try {
    const transaction = await DurableFileTransaction.begin({
      projectPath: f.project, operationName: "interrupted install test", operation: "install", packageIds: ["interrupted"],
    });
    await transaction.recordModifiedFile(join(f.project, "aurora.lock"));
    await transaction.beginMutation();
    await f.manager.register("interrupted", "1.0.0");
  } finally {
    await held.release();
  }
  await assert.rejects(install("alpha", f.options, f.deps), /changed while/);
  await absent(join(f.project, "aurora.lock"));
  await absent(join(f.project, "src"));
  await f.clean();
  await install("alpha", f.options, f.deps);
  assert.equal(f.requests.length, 1);
  await new InstalledStateVerifier().verify("alpha", f.project);
  await f.clean();
});

test("official reinstall refuses altered installed files instead of trusting the installed cache", async t => {
  const f = await fixture(t);
  await install("alpha", f.options, f.deps);
  await fs.writeFile(join(f.project, "src/alpha.txt"), "user edit");
  await assert.rejects(install("alpha", f.options, f.deps), /recorded installed digest/);
  assert.equal(await fs.readFile(join(f.project, "src/alpha.txt"), "utf8"), "user edit");
  assert.equal(f.requests.length, 1);
  await f.clean();
});

test("official install cannot adopt a previously installed package with a missing lock", async t => {
  const f = await fixture(t);
  await install("alpha", f.options, f.deps);
  await f.manager.write({ packages: {} });
  await assert.rejects(install("alpha", f.options, f.deps), /implicit adoption/);
  assert.deepEqual((await f.manager.read()).packages, {});
  assert.equal(await fs.readFile(join(f.project, "src/alpha.txt"), "utf8"), "alpha@1.0.0\n");
  await f.clean();
});

test("official reinstall rejects a mismatched installed-cache version", async t => {
  const f = await fixture(t);
  await install("alpha", f.options, f.deps);
  const path = join(f.project, ".aurora/cache.json");
  const cache = JSON.parse(await fs.readFile(path, "utf8"));
  cache.alpha.version = "9.0.0";
  await fs.writeFile(path, JSON.stringify(cache));
  await assert.rejects(install("alpha", f.options, f.deps), /cache version.*ownership receipt/);
  assert.equal((await f.manager.read()).packages.alpha.version, "1.0.0");
  await f.clean();
});
