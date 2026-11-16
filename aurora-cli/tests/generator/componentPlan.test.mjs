import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTemplates } from "../../dist/templates/registry/templateRegistry.js";
import { ComponentGenerator } from "../../dist/generator/componentGenerator.js";
import { OperationPlanService } from "../../dist/operations/operationPlanService.js";
import { runCli } from "../../dist/cli.js";
import "../../dist/commands/generateRegistration.js";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurora-component-plan-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(project);
  return { root, project, target: join(project, "src/components/Header.tsx") };
}

async function cli(args, cwd) {
  try {
    return { code: 0, ...await execute(process.execPath, [entry, ...args], {
      cwd, windowsHide: true, timeout: 30000,
      env: { ...process.env, FORCE_COLOR: "0" },
    }) };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("component CLI requires approval and dry runs leave the project empty", async t => {
  const { project } = await fixture(t);
  const unapproved = await cli(["generate", "component", ".", "Header", "--json"], project);
  assert.equal(unapproved.code, 1);
  assert.match(unapproved.stderr, /OPERATION_APPROVAL_REQUIRED/);
  const preview = JSON.parse(unapproved.stdout);
  assert.equal(preview.intent, "generate.component");
  assert.equal(preview.operations[0].path, "src/components/Header.tsx");
  assert.deepEqual(await readdir(project), []);

  const dryRun = await cli(["generate", "component", ".", "Header", "--dry-run", "--yes", "--json"], project);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).status, "dry-run");
  assert.deepEqual(await readdir(project), []);
});

test("exported component plans apply through the shared executor and retain recovery evidence", async t => {
  const { root, project, target } = await fixture(t);
  const planFile = join(root, "header-plan.json");
  const planned = await cli(["generate", "component", project, "Header", "--plan", planFile, "--json"], root);
  assert.equal(planned.code, 0, planned.stderr);
  const plan = JSON.parse(planned.stdout);
  assert.deepEqual(plan, JSON.parse(await readFile(planFile, "utf8")));
  assert.equal(plan.operations.length, 1);
  assert.deepEqual(plan.operations[0].expected, { exists: false });
  assert.deepEqual(await readdir(project), []);

  const repeated = await cli(["generate", "component", project, "Header", "--plan", planFile], root);
  assert.notEqual(repeated.code, 0);
  assert.deepEqual(JSON.parse(await readFile(planFile, "utf8")), plan);

  const wrongProject = await cli(["apply", planFile, "--project", root, "--yes"], root);
  assert.equal(wrongProject.code, 1);
  assert.match(wrongProject.stderr, /different project root/);
  const applied = await cli(["apply", planFile, "--project", project, "--yes", "--json"], root);
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).totals.applied, 1);
  assert.equal(await readFile(target, "utf8"), plan.operations[0].content);
  assert.equal((await readdir(join(project, ".aurora/operation-journal"))).length, 1);
});

test("direct approval preserves literal dollar names and rejects existing components", async t => {
  const { project } = await fixture(t);
  const result = await cli(["generate", "component", ".", "$$Header", "--yes", "--json"], project);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).totals.applied, 1);
  const target = join(project, "src/components/$$Header.tsx");
  const content = await readFile(target, "utf8");
  assert.match(content, /function \$\$Header\(\)/);
  await writeFile(target, "// my edited component\n");
  const repeated = await cli(["generate", "component", ".", "$$Header", "--yes"], project);
  assert.equal(repeated.code, 1);
  assert.match(repeated.stderr, /COMPONENT_ALREADY_EXISTS/);
  assert.equal(await readFile(target, "utf8"), "// my edited component\n");
});

test("component preview and approval never activate catalog or runtime services", async t => {
  const { project } = await fixture(t);
  const tripwire = {
    async prepareCatalog() { assert.fail("Catalog activation"); },
    async activate() { assert.fail("Runtime activation"); },
    async shutdown() { assert.fail("Runtime shutdown"); },
  };
  for (const option of ["--dry-run", "--yes"]) {
    await runCli(["node", "aurora", "generate", "component", project, "Header", option, "--quiet"], tripwire);
  }
  assert.match(await readFile(join(project, "src/components/Header.tsx"), "utf8"), /function Header/);
});

test("conflicting export options and unsafe names fail without creating files", async t => {
  const { root, project } = await fixture(t);
  for (const option of ["--yes", "--dry-run"]) {
    const result = await cli(["generate", "component", project, "Header", "--plan", "plan.json", option], root);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /cannot be used/);
    assert.deepEqual(await readdir(root), ["project"]);
  }
  for (const name of ["../Escaped", "bad-name", "CON"]) {
    const result = await cli(["generate", "component", project, name, "--dry-run"], root);
    assert.equal(result.code, 1);
    assert.deepEqual(await readdir(project), []);
  }
});

test("a new target after planning blocks apply and preserves the user's file", async t => {
  const { project, target } = await fixture(t);
  await discoverTemplates();
  const plan = await new ComponentGenerator().plan(project, "Header");
  await mkdir(join(project, "src/components"), { recursive: true });
  await writeFile(target, "user component");
  await assert.rejects(new OperationPlanService().apply(plan, project, { approved: true }),
    { code: "OPERATION_PLAN_DRIFT" });
  assert.equal(await readFile(target, "utf8"), "user component");
});

test("component planning rejects linked output directories", async t => {
  const { root, project } = await fixture(t);
  const outside = join(root, "outside");
  const link = join(project, "src/components");
  await mkdir(outside);
  await mkdir(join(project, "src"));
  await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  t.after(() => rm(link, { force: true }));
  await discoverTemplates();
  await assert.rejects(new ComponentGenerator().plan(project, "Header"), { code: "UNSAFE_PROJECT_PATH" });
  assert.deepEqual(await readdir(outside), []);
});
