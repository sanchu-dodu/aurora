import {
  spawn,
} from "node:child_process";

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
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

async function verifyInstalledPackage(
  installedRoot
) {
  const requiredPaths = [
    "dist/index.js",
    "dist/plugins/helloPlugin.js",
    "packages/auth/manifest.json",
    "docs/package-manifest-v1.md",
    "docs/package-trust-v1.md",
    "docs/operation-plan-v1.md",
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
