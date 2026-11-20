import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CacheManager } from "../../dist/packages/cache/cacheManager.js";
import { PackageInstaller } from "../../dist/packages/installer/packageInstaller.js";
import { PackageWorker } from "../../dist/packages/installation/packageWorker.js";
import { ProjectLifecycleLock } from "../../dist/packages/lifecycle/projectLifecycleLock.js";
import { getDefaultPackageRoot } from "../../dist/packages/packagePaths.js";
import { createManifestV1 } from "./manifestTestUtils.mjs";
import { runCli } from "../../dist/cli.js";
import "../../dist/commands/packageRegistration.js";

const cliEntry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurora-package-preview-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function cli(cwd, args) {
  const env = { ...process.env, FORCE_COLOR: "0" };
  delete env.NO_COLOR;
  return spawnSync(process.execPath, [cliEntry, "package", "install", ...args], {
    cwd, env, windowsHide: true, encoding: "utf8", timeout: 30000,
  });
}

test("package install dry-run reports dependency batches and declared authority without creating files", async t => {
  const root = await fixture(t);
  const result = cli(root, ["auth", "--dry-run", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.status, "dry-run");
  assert.equal(report.projectRoot, root);
  assert.equal(report.requestedPackage, "auth");
  assert.equal(report.projectStateChecked, false);
  assert.deepEqual(report.batches, [["database", "env"], ["auth"]]);
  assert.deepEqual(report.installationOrder, report.batches.flat());
  assert.deepEqual(report.packages.map(p => p.id), report.installationOrder);
  const auth = report.packages[2];
  assert.equal(auth.version, "1.0.0");
  assert.match(auth.artifactDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(auth.dependencies, ["database", "env"]);
  assert.ok(auth.declaredCapabilities.includes("package.code.execute"));
  assert.equal(auth.declaresInstaller, true);
  assert.equal(auth.declaresHooks, true);
  assert.deepEqual(await readdir(root), []);
});

test("human output and JSON-only rejection do not install the selected package", async t => {
  const root = await fixture(t);
  const text = cli(root, ["database", "--dry-run"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Batch 1: database/u);
  assert.match(text.stdout, /no package code ran and no files were written/u);
  assert.doesNotMatch(text.stdout, /Installation finished|Aurora Runtime|plugin activated/iu);
  const rejected = cli(root, ["database", "--json"]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /requires --dry-run/u);
  const missing = cli(root, ["not-a-package", "--dry-run", "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  const quiet = cli(root, ["auth", "--dry-run", "--json", "--quiet"]);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(quiet.stdout, "");
  assert.deepEqual(await readdir(root), []);
});

test("manifest preflight does not enter the cache, lifecycle lock, or package worker", async t => {
  const root = await fixture(t);
  t.mock.method(CacheManager.prototype, "readExisting", () => assert.fail("Read installed cache"));
  t.mock.method(ProjectLifecycleLock, "acquire", () => assert.fail("Acquired lifecycle lock"));
  t.mock.method(PackageWorker.prototype, "install", () => assert.fail("Ran package worker"));
  await mkdir(join(root, ".aurora"));
  await writeFile(join(root, ".aurora/cache.json"), "not valid state");
  const report = await new PackageInstaller({ projectRoot: root }).preview("auth");
  assert.equal(report.projectStateChecked, false);
  assert.deepEqual(await readdir(root), [".aurora"]);
  assert.deepEqual(await readdir(join(root, ".aurora")), ["cache.json"]);
  assert.equal(await readFile(join(root, ".aurora/cache.json"), "utf8"), "not valid state");
});

test("CLI dry-run does not activate the catalog or runtime", async t => {
  t.mock.method(console, "log", () => {});
  const tripwire = {
    async prepareCatalog() { assert.fail("Catalog activation"); },
    async activate() { assert.fail("Runtime activation"); },
    async shutdown() { assert.fail("Runtime shutdown"); },
  };
  await runCli(["node", "aurora", "package", "install", "auth", "--dry-run", "--json"], tripwire);
});

test("publisher authentication is required before trusting changed dependency declarations", async t => {
  const root = await fixture(t);
  const packageRoot = join(root, "packages");
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  await cp(join(getDefaultPackageRoot(), "database"), join(packageRoot, "database"), { recursive: true });
  const manifestFile = join(packageRoot, "database", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.dependencies = [{ id: "unavailable", version: "^1.0.0", optional: false }];
  await writeFile(manifestFile, JSON.stringify(manifest));
  await assert.rejects(new PackageInstaller({ packageRoot, projectRoot }).preview("database"),
    { code: "PACKAGE_SIGNATURE_INVALID" });
  assert.deepEqual(await readdir(projectRoot), []);
});

for (const scenario of ["incompatible", "revoked", "cycle", "conflict"]) {
  test(`preview rejects ${scenario} package sets without writing to the project`, async t => {
    const root = await fixture(t);
    const packageRoot = join(root, "packages");
    const projectRoot = join(root, "project");
    await mkdir(projectRoot);
    const dependencies = [{ id: "beta", version: "^1.0.0", optional: false }];
    const manifests = scenario === "conflict"
      ? [
        createManifestV1({ id: "alpha", dependencies: [...dependencies,
          { id: "gamma", version: "^1.0.0", optional: false }] }),
        createManifestV1({ id: "beta", conflicts: [{ id: "gamma", version: "^1.0.0" }] }),
        createManifestV1({ id: "gamma" }),
      ]
      : [
        createManifestV1({ id: "alpha", dependencies }),
        createManifestV1({ id: "beta",
          ...(scenario === "incompatible" ? { compatibility: { aurora: ">=999.0.0", node: ">=22.0.0" } } : {}),
          ...(scenario === "revoked" ? { lifecycle: { deprecated: false, revoked: true, reason: "Test revocation" } } : {}),
          ...(scenario === "cycle" ? { dependencies: [{ id: "alpha", version: "^1.0.0", optional: false }] } : {}),
        }),
      ];
    for (const manifest of manifests) {
      await mkdir(join(packageRoot, manifest.id), { recursive: true });
      await writeFile(join(packageRoot, manifest.id, "manifest.json"), JSON.stringify(manifest));
    }
    // These isolated fixtures exercise graph checks independently of signatures.
    const installer = new PackageInstaller({ packageRoot, projectRoot, trust: { requireSignatures: false } });
    await assert.rejects(installer.preview("alpha"), scenario === "cycle"
      ? /Circular dependency/u
      : { code: scenario === "revoked" ? "PACKAGE_REVOKED" : "PACKAGE_INCOMPATIBLE" });
    assert.deepEqual(await readdir(projectRoot), []);
  });
}

test("artifact verification rejects unexpected files before previewing a signed package", async t => {
  const root = await fixture(t);
  const packageRoot = join(root, "packages");
  const projectRoot = join(root, "project");
  await mkdir(projectRoot);
  await cp(join(getDefaultPackageRoot(), "database"), join(packageRoot, "database"), { recursive: true });
  await writeFile(join(packageRoot, "database", "unexpected.txt"), "Not in the signed inventory.");
  await assert.rejects(new PackageInstaller({ packageRoot, projectRoot }).preview("database"),
    { code: "PACKAGE_INTEGRITY_FAILED" });
  assert.deepEqual(await readdir(projectRoot), []);
});

test("plain package install still records a transactional install", async t => {
  const root = await fixture(t);
  await writeFile(join(root, "package.json"), '{"name":"package-install-smoke","version":"1.0.0"}\n');
  const install = cli(root, ["database"]);
  assert.equal(install.status, 0, install.stderr);
  assert.match(install.stdout, /Installation finished/u);
  const lock = JSON.parse(await readFile(join(root, "aurora.lock"), "utf8"));
  assert.ok(Object.keys(lock.packages).includes("database"));
});
