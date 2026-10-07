import {
  spawn,
} from "node:child_process";

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  basename,
  join,
} from "node:path";

import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

const cliRoot =
  fileURLToPath(
    new URL(
      "../",
      import.meta.url
    )
  );

function runProcess(
  command,
  args,
  {
    cwd = cliRoot,
    label = command,
    shell = false,
  } = {}
) {
  return new Promise(
    (resolve, reject) => {
      const child =
        spawn(
          command,
          args,
          {
            cwd,
            shell,
            windowsHide: true,

            env: {
              ...process.env,
              FORCE_COLOR: "0",
            },

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          }
        );

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding(
        "utf8"
      );

      child.stderr.setEncoding(
        "utf8"
      );

      child.stdout.on(
        "data",
        (chunk) => {
          stdout += chunk;
        }
      );

      child.stderr.on(
        "data",
        (chunk) => {
          stderr += chunk;
        }
      );

      child.once(
        "error",
        reject
      );

      child.once(
        "close",
        (code, signal) => {
          if (
            code !== 0 ||
            signal !== null
          ) {
            reject(
              new Error(
                [
                  `${label} failed.`,
                  `Exit code: ${code}`,
                  `Signal: ${signal ?? "none"}`,
                  "",
                  stdout.trim(),
                  stderr.trim(),
                ]
                  .filter(Boolean)
                  .join("\n")
              )
            );

            return;
          }

          resolve({
            stdout,
            stderr,
          });
        }
      );
    }
  );
}

function getNpmInvocation(
  args
) {
  const npmExecPath =
    process.env.npm_execpath;

  if (npmExecPath) {
    return {
      command:
        process.execPath,

      args: [
        npmExecPath,
        ...args,
      ],

      shell: false,
    };
  }

  return {
    command:
      process.platform === "win32"
        ? "npm.cmd"
        : "npm",

    args,

    shell:
      process.platform === "win32",
  };
}

async function runNpm(
  args,
  options = {}
) {
  const invocation =
    getNpmInvocation(args);

  return runProcess(
    invocation.command,
    invocation.args,
    {
      ...options,
      shell:
        invocation.shell,
    }
  );
}

async function pathExists(
  targetPath
) {
  try {
    await access(
      targetPath
    );

    return true;
  } catch {
    return false;
  }
}

function assertCondition(
  condition,
  message
) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runAurora(
  consumerRoot,
  packageName,
  args
) {
  const binName =
    process.platform === "win32"
      ? "aurora.cmd"
      : "aurora";

  const binPath =
    join(
      consumerRoot,
      "node_modules",
      ".bin",
      binName
    );

  assertCondition(
    await pathExists(binPath),
    `Installed Aurora executable was not found: ${binPath}`
  );

  if (
    process.platform === "win32"
  ) {
    const installedRoot =
      join(
        consumerRoot,
        "node_modules",
        ...packageName.split("/")
      );

    const installedPackageJson =
      JSON.parse(
        await readFile(
          join(
            installedRoot,
            "package.json"
          ),
          "utf8"
        )
      );

    const binTarget =
      typeof installedPackageJson.bin ===
        "string"
        ? installedPackageJson.bin
        : installedPackageJson.bin?.aurora;

    assertCondition(
      typeof binTarget === "string" &&
      binTarget.length > 0,
      "Installed package does not define the Aurora executable."
    );

    const entryPath =
      join(
        installedRoot,
        binTarget.replace(
          /^\.\//,
          ""
        )
      );

    assertCondition(
      await pathExists(entryPath),
      `Installed Aurora entry file was not found: ${entryPath}`
    );

    const wrapperContent =
      (
        await readFile(
          binPath,
          "utf8"
        )
      )
        .replaceAll(
          "\\",
          "/"
        );

    assertCondition(
      wrapperContent.includes(
        "dist/index.js"
      ),
      "The installed Windows Aurora wrapper does not reference dist/index.js."
    );

    return runProcess(
      process.execPath,
      [
        entryPath,
        ...args,
      ],
      {
        cwd:
          consumerRoot,

        label:
          `aurora ${args.join(" ")}`,
      }
    );
  }

  return runProcess(
    binPath,
    args,
    {
      cwd:
        consumerRoot,

      label:
        `aurora ${args.join(" ")}`,
    }
  );
}
async function verifyGeneratedProject(
  projectRoot
) {
  const requiredPaths = [
    "package.json",
    "aurora.config.json",
    ".gitignore",
    "app/page.tsx",
    "app/layout.tsx",
  ];

  for (
    const relativePath
    of requiredPaths
  ) {
    assertCondition(
      await pathExists(
        join(
          projectRoot,
          relativePath
        )
      ),
      `Generated project is missing: ${relativePath}`
    );
  }

  const forbiddenPaths = [
    "gitignore.template",
    "template.json",
  ];

  for (
    const relativePath
    of forbiddenPaths
  ) {
    assertCondition(
      !await pathExists(
        join(
          projectRoot,
          relativePath
        )
      ),
      `Generated project unexpectedly contains: ${relativePath}`
    );
  }
}

async function verifyInstalledPackageTrust(
  installedRoot
) {
  const manifestModule =
    await import(
      pathToFileURL(
        join(
          installedRoot,
          "dist",
          "packages",
          "manifestLoader.js"
        )
      ).href
    );

  const trustModule =
    await import(
      pathToFileURL(
        join(
          installedRoot,
          "dist",
          "packages",
          "trust",
          "packageTrustPolicy.js"
        )
      ).href
    );

  const loadManifest =
    manifestModule.loadManifest;

  const PackageTrustPolicy =
    trustModule.PackageTrustPolicy;

  assertCondition(
    typeof loadManifest === "function",
    "Installed package does not expose its production manifest loader."
  );

  assertCondition(
    typeof PackageTrustPolicy === "function",
    "Installed package does not expose its production trust policy."
  );

  const trustPolicy =
    new PackageTrustPolicy();

  const packageIds = [
    "auth",
    "database",
    "env",
  ];

  for (
    const packageId
    of packageIds
  ) {
    const manifest =
      await loadManifest(
        join(
          installedRoot,
          "packages",
          packageId,
          "manifest.json"
        )
      );

    assertCondition(
      manifest.id === packageId,
      `Installed package manifest identity mismatch for ${packageId}.`
    );

    assertCondition(
      manifest.publisher?.id ===
        "aurora-technologies",
      `Installed package ${packageId} is not bound to the official Aurora publisher.`
    );

    assertCondition(
      manifest.signature?.version === 1 &&
      manifest.signature?.algorithm ===
        "ed25519",
      `Installed package ${packageId} does not contain the required Ed25519 signature envelope.`
    );

    const verification =
      trustPolicy.verify(
        manifest
      );

    assertCondition(
      verification?.publisherId ===
        "aurora-technologies" &&
      verification?.keyId ===
        manifest.signature.keyId &&
      verification?.algorithm ===
        "ed25519",
      `Installed package ${packageId} failed production publisher authentication.`
    );

    const {
      signature: _signature,
      ...unsignedManifest
    } = manifest;

    let rejectionCode;

    try {
      trustPolicy.verify(
        unsignedManifest
      );
    }
    catch (error) {
      rejectionCode =
        error?.code;
    }

    assertCondition(
      rejectionCode ===
        "PACKAGE_SIGNATURE_REQUIRED",
      `Installed production trust policy did not fail closed on unsigned ${packageId}.`
    );
  }

  console.log(
    "Verified installed Aurora package signatures and secure trust defaults."
  );
}

async function verifyNoPrivateKeyMaterial(
  installedRoot
) {
  const markerParts = [
    ["BEGIN ", "PRIVATE KEY"],
    ["BEGIN ", "ENCRYPTED PRIVATE KEY"],
    ["BEGIN ", "OPENSSH PRIVATE KEY"],
    ["BEGIN ", "ED25519 PRIVATE KEY"],
  ];

  const markers =
    markerParts.map(
      parts => {
        const value =
          parts.join("");

        return {
          value,
          bytes:
            Buffer.from(
              value,
              "utf8"
            ),
        };
      }
    );

  async function visit(
    directory
  ) {
    const entries =
      await readdir(
        directory,
        {
          withFileTypes:
            true,
        }
      );

    for (const entry of entries) {
      const targetPath =
        join(
          directory,
          entry.name
        );

      if (entry.isDirectory()) {
        await visit(
          targetPath
        );

        continue;
      }

      assertCondition(
        entry.isFile(),
        `Installed package contains unsupported filesystem entry: ${targetPath}`
      );

      const bytes =
        await readFile(
          targetPath
        );

      for (const marker of markers) {
        assertCondition(
          !bytes.includes(
            marker.bytes
          ),
          `Installed package contains private signing-key marker ${marker.value}: ${targetPath}`
        );
      }
    }
  }

  await visit(
    installedRoot
  );

  console.log(
    "Verified installed package contains no private signing-key markers."
  );
}
async function verifyInstalledPackage(
  installedRoot
) {
  const requiredPaths = [
    "dist/index.js",
    "dist/plugins/helloPlugin.js",
    "packages/auth/manifest.json",
    "packages/database/manifest.json",
    "packages/env/manifest.json",
    "docs/package-manifest-v1.md",
    "docs/package-trust-v1.md",
    "docs/package-signing-operations.md",
    "docs/operation-plan-v1.md",
    "dist/operations/operationJournal.js",
    "dist/operations/operationJournal.d.ts",
    "dist/operations/durableOperationTransaction.js",
    "dist/operations/durableOperationTransaction.d.ts",
    "dist/operations/operationRecoveryService.js",
    "dist/operations/operationRecoveryService.d.ts",
    "docs/solution-packs-v1.md",
    "dist/solutions/index.js",
    "dist/solutions/index.d.ts",
    "docs/extension-worker-v1.md",
    "dist/plugins/helloExtension.js",
    "dist/plugins/helloExtension.manifest.json",
    "dist/runtime/extensions/extensionWorkerHost.js",
    "dist/runtime/extensions/extensionWorkerRuntime.js",
    "templates/projects/nextjs/template.json",
    "templates/generators/react/component.json",
  ];

  for (
    const relativePath
    of requiredPaths
  ) {
    assertCondition(
      await pathExists(
        join(
          installedRoot,
          relativePath
        )
      ),
      `Installed package is missing: ${relativePath}`
    );
  }

  const forbiddenPaths = [
    "src",
    "tests",
    "scripts",
    "AuroraCore",
    "AuroraGalaxy",
    "AuroraStudio",
  ];

  for (
    const relativePath
    of forbiddenPaths
  ) {
    assertCondition(
      !await pathExists(
        join(
          installedRoot,
          relativePath
        )
      ),
      `Installed package unexpectedly contains: ${relativePath}`
    );
  }

  await verifyInstalledPackageTrust(
    installedRoot
  );

  await verifyNoPrivateKeyMaterial(
    installedRoot
  );
}

async function main() {
  const packageJson =
    JSON.parse(
      await readFile(
        join(
          cliRoot,
          "package.json"
        ),
        "utf8"
      )
    );

  const smokeRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-release-check-"
      )
    );

  const packageDirectory =
    join(
      smokeRoot,
      "package"
    );

  const consumerRoot =
    join(
      smokeRoot,
      "consumer"
    );

  const keepWorkspace =
    process.env
      .AURORA_KEEP_RELEASE_SMOKE ===
    "1";

  try {
    await mkdir(
      packageDirectory,
      {
        recursive: true,
      }
    );

    await mkdir(
      consumerRoot,
      {
        recursive: true,
      }
    );

    console.log(
      "\n===== Creating production package ====="
    );

    const packResult =
      await runNpm(
        [
          "pack",
          "--json",
          "--silent",
          "--pack-destination",
          packageDirectory,
        ],
        {
          cwd:
            cliRoot,

          label:
            "npm pack",
        }
      );

    const packResults =
      JSON.parse(
        packResult.stdout.trim()
      );

    const pack =
      Array.isArray(
        packResults
      )
        ? packResults[0]
        : packResults;

    assertCondition(
      pack &&
      typeof pack.filename ===
        "string",
      "npm pack did not return a package filename."
    );

    const tarballPath =
      join(
        packageDirectory,
        pack.filename
      );

    assertCondition(
      await pathExists(
        tarballPath
      ),
      `Package tarball was not created: ${tarballPath}`
    );

    console.log(
      `Created ${basename(tarballPath)}`
    );

    await writeFile(
      join(
        consumerRoot,
        "package.json"
      ),
      `${JSON.stringify(
        {
          name:
            "aurora-release-smoke-consumer",

          version:
            "1.0.0",

          private:
            true,
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    console.log(
      "\n===== Installing packed Aurora CLI ====="
    );

    await runNpm(
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        tarballPath,
      ],
      {
        cwd:
          consumerRoot,

        label:
          "Installing packed Aurora CLI",
      }
    );

    console.log(
      "\n===== Verifying installed executable ====="
    );

    const versionResult =
      await runAurora(
        consumerRoot,
        packageJson.name,
        [
          "--version",
        ]
      );

    assertCondition(
      versionResult.stdout.includes(
        packageJson.version
      ),
      `Installed CLI did not report version '${packageJson.version}'.`
    );

    const helpResult =
      await runAurora(
        consumerRoot,
        packageJson.name,
        [
          "--help",
        ]
      );

    assertCondition(
      /Usage:\s+aurora/i.test(
        helpResult.stdout
      ),
      "Installed CLI help did not contain the Aurora usage line."
    );

    assertCondition(
      !/Aurora Runtime|plugin activated/i.test(
        `${versionResult.stdout}\n${helpResult.stdout}`
      ),
      "Installed CLI activated the runtime while handling version or help."
    );

    const completionResult =
      await runAurora(
        consumerRoot,
        packageJson.name,
        [
          "completion",
          "powershell",
        ]
      );

    assertCondition(
      /Register-ArgumentCompleter/.test(
        completionResult.stdout
      ),
      "Installed CLI did not generate PowerShell completion setup."
    );

    assertCondition(
      !/Aurora Runtime|plugin activated/i.test(
        completionResult.stdout
      ),
      "Installed CLI activated the runtime while generating completion setup."
    );

    const templateInfoResult =
      await runAurora(
        consumerRoot,
        packageJson.name,
        [
          "template",
          "info",
          "nextjs",
        ]
      );

    assertCondition(
      templateInfoResult.stdout.includes(
        "Aurora Next.js Starter"
      ),
      "Installed CLI could not discover the packaged Next.js template."
    );

    await runAurora(
        consumerRoot,
        packageJson.name,
        [
        "plugin",
        "list",
      ]
    );

    console.log(
      "\n===== Creating project from installed package ====="
    );

    await runAurora(
        consumerRoot,
        packageJson.name,
        [
        "template",
        "install",
        "nextjs",
        "smoke-project",
      ]
    );

    const generatedProject =
      join(
        consumerRoot,
        "smoke-project"
      );

    await verifyGeneratedProject(
      generatedProject
    );

    const inspectionResult = await runAurora(consumerRoot, packageJson.name, [
      "project", "inspect", "--project", generatedProject, "--json",
    ]);
    const inspection = JSON.parse(inspectionResult.stdout);
    assertCondition(inspection.schemaVersion === 1 && inspection.healthy &&
      inspection.node !== null && inspection.pendingOperationPlans === 0,
      "Installed CLI did not inspect the generated project successfully.");
    const sdkResult = await runProcess(process.execPath, [
      "--input-type=module", "--eval",
      `import { inspectProject } from ${JSON.stringify(packageJson.name + "/projects")};` +
      `console.log(JSON.stringify(inspectProject(${JSON.stringify(generatedProject)})));`,
    ], { cwd: consumerRoot, label: "Verifying installed shared project API" });
    assertCondition(JSON.stringify(JSON.parse(sdkResult.stdout)) === JSON.stringify(inspection),
      "Installed project API and CLI inspection disagree.");
    console.log("Verified installed project inspection command and shared API.");

    const solutionResult = await runAurora(consumerRoot, packageJson.name, [
      "create", "web-app", "smoke-solution", "--json",
    ]);
    const solutionRoot = JSON.parse(solutionResult.stdout).root;
    await verifyGeneratedProject(solutionRoot);
    const healthPlanFile = join(consumerRoot, "health-plan.json");
    const preview = await runAurora(consumerRoot, packageJson.name, [
      "capability", "plan", "health", "--project", solutionRoot, "--out", healthPlanFile, "--json",
    ]);
    assertCondition(JSON.parse(preview.stdout).operations.length === 2,
      "Installed capability planner did not return its two-file preview.");
    assertCondition(!await pathExists(join(solutionRoot, "app/api/health/route.ts")),
      "Installed preview unexpectedly created the health endpoint.");
    await runAurora(consumerRoot, packageJson.name, [
      "apply", healthPlanFile, "--project", solutionRoot, "--dry-run", "--json",
    ]);
    assertCondition(!await pathExists(join(solutionRoot, "app/api/health/route.ts")),
      "Installed dry-run unexpectedly created the health endpoint.");
    const applied = await runAurora(consumerRoot, packageJson.name, [
      "apply", healthPlanFile, "--project", solutionRoot, "--yes", "--json",
    ]);
    assertCondition(JSON.parse(applied.stdout).totals.applied === 2,
      "Installed capability plan did not apply both writes.");
    const operationJournalRoot = join(solutionRoot, ".aurora", "operation-journal");
    const committedTransactions = (await readdir(operationJournalRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && entry.name !== "recovered");
    assertCondition(committedTransactions.length === 1,
      "Installed capability apply did not retain one durable transaction record.");
    const committedJournalPath = join(operationJournalRoot, committedTransactions[0].name, "journal.json");
    const committedJournalBefore = await readFile(committedJournalPath, "utf8");
    assertCondition(JSON.parse(committedJournalBefore).journal.phase === "committed",
      "Installed capability apply did not commit its durable recovery record.");
    const solutionStatePath = join(solutionRoot, ".aurora", "solution.json");
    const healthRoute = join(solutionRoot, "app/api/health/route.ts");
    const solutionStateBefore = await readFile(solutionStatePath, "utf8");
    const healthRouteBefore = await readFile(healthRoute, "utf8");
    const recoveryPlansResult = await runAurora(consumerRoot, packageJson.name, [
      "recovery", "plans", "--project", solutionRoot, "--json",
    ]);
    const recoveryPlans = JSON.parse(recoveryPlansResult.stdout);
    assertCondition(recoveryPlans.schemaVersion === 1 && recoveryPlans.root === solutionRoot &&
      Array.isArray(recoveryPlans.transactions) && recoveryPlans.transactions.length === 0,
      "Installed recovery listing reported pending records after a committed capability apply.");
    assertCondition(!/Aurora Runtime|plugin activated/i.test(
      `${recoveryPlansResult.stdout}\n${recoveryPlansResult.stderr}`) &&
      await readFile(committedJournalPath, "utf8") === committedJournalBefore &&
      await readFile(solutionStatePath, "utf8") === solutionStateBefore &&
      await readFile(healthRoute, "utf8") === healthRouteBefore &&
      !await pathExists(join(solutionRoot, ".aurora", "lifecycle-lock")),
      "Installed recovery listing changed project state, retained a lock, or activated the runtime.");
    const recoveryPlanHelp = await runAurora(consumerRoot, packageJson.name, [
      "recovery", "plan", "--help",
    ]);
    assertCondition(/Usage:\s+aurora recovery plan/i.test(recoveryPlanHelp.stdout) &&
      recoveryPlanHelp.stdout.includes("--dry-run") && recoveryPlanHelp.stdout.includes("--yes") &&
      !/Aurora Runtime|plugin activated/i.test(`${recoveryPlanHelp.stdout}\n${recoveryPlanHelp.stderr}`),
      "Installed explicit plan recovery help is unavailable or activated the runtime.");
    const capabilityVerification = await runAurora(consumerRoot, packageJson.name, [
      "capability", "verify", "--project", solutionRoot, "--json",
    ]);
    assertCondition(JSON.parse(capabilityVerification.stdout).clean === true,
      "Installed capability verification did not recognize the generated files.");
    const solutionsApi = await runProcess(process.execPath, [
      "--input-type=module", "--eval",
      `import { listSolutionPacks, inspectCapabilities } from ${JSON.stringify(packageJson.name + "/solutions")};` +
      `import { inspectProject } from ${JSON.stringify(packageJson.name + "/projects")};` +
      `console.log(JSON.stringify({packs:listSolutionPacks(),project:inspectProject(${JSON.stringify(solutionRoot)}),files:inspectCapabilities(${JSON.stringify(solutionRoot)})}));`,
    ], { cwd: consumerRoot, label: "Verifying installed solutions API" });
    const solutionReport = JSON.parse(solutionsApi.stdout);
    assertCondition(solutionReport.packs[0].id === "web-app" && solutionReport.project.healthy &&
      solutionReport.project.pendingOperationPlans === 0 &&
      solutionReport.project.solution.capabilities[0].id === "health" &&
      solutionReport.files.clean === true &&
      JSON.stringify(solutionReport.files) === JSON.stringify(JSON.parse(capabilityVerification.stdout)),
      "Installed solution API could not inspect the added health capability.");
    const userEdit = await readFile(healthRoute, "utf8") + "\n// User-owned edit.\n";
    await writeFile(healthRoute, userEdit, "utf8");
    const changedApi = await runProcess(process.execPath, [
      "--input-type=module", "--eval",
      `import { inspectCapabilities } from ${JSON.stringify(packageJson.name + "/solutions")};` +
      `console.log(JSON.stringify(inspectCapabilities(${JSON.stringify(solutionRoot)})));`,
    ], { cwd: consumerRoot, label: "Verifying installed read-only capability change detection" });
    const changedReport = JSON.parse(changedApi.stdout);
    assertCondition(changedReport.healthy && !changedReport.clean &&
      changedReport.capabilities[0].files[0].status === "modified" &&
      await readFile(healthRoute, "utf8") === userEdit,
      "Installed capability inspection did not preserve and report a user edit.");
    console.log("Verified installed starter creation, capability preview/dry-run/apply, read-only recovery listing, change detection, and solutions API.");

    await verifyInstalledPackage(
      join(
        consumerRoot,
        "node_modules",
        ...packageJson.name.split("/")
      )
    );

    console.log(
      "\nInstalled-package release smoke test passed."
    );
  } finally {
    if (keepWorkspace) {
      console.log(
        `\nRelease smoke workspace preserved: ${smokeRoot}`
      );
    } else {
      await rm(
        smokeRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
}

try {
  await main();
} catch (error) {
  console.error("");
  console.error(
    error instanceof Error
      ? error.stack ??
        error.message
      : String(error)
  );

  process.exitCode = 1;
}
