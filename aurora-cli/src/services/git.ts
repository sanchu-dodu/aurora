import fs from "node:fs";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

import {
  runProcess,
} from "./processService.js";

import type {
  SafeProcessResult,
  SafeProcessRunner,
} from "./processService.js";

const GIT_TIMEOUT_MS =
  30_000;

const STAGING_BATCH_SIZE =
  100;

export async function initializeGit(
  projectPath: string,
  generatedFiles:
    readonly string[],
  processRunner:
    SafeProcessRunner = runProcess
): Promise<void> {
  const pathBoundary =
    new ProjectPathBoundary(
      projectPath
    );

  const projectRoot =
    pathBoundary.projectRoot;

  const files =
    Array.from(
      new Set(
        generatedFiles.map(
          relativePath => {
            const file =
              pathBoundary.resolve(
                relativePath
              );

            let information:
              fs.Stats;

            try {
              information =
                fs.statSync(file);
            } catch (error) {
              throw new Error(
                `Generated Git target '${relativePath}' does not exist.`,
                {
                  cause: error,
                }
              );
            }

            if (
              !information.isFile()
            ) {
              throw new Error(
                `Generated Git target '${relativePath}' is not a file.`
              );
            }

            return relativePath
              .replaceAll(
                "\\",
                "/"
              );
          }
        )
      )
    ).sort();

  await runGit(
    processRunner,
    projectRoot,
    [
      "init",
    ],
    "inherit"
  );

  for (
    let index = 0;
    index < files.length;
    index += STAGING_BATCH_SIZE
  ) {
    await runGit(
      processRunner,
      projectRoot,
      [
        "add",
        "--",
        ...files.slice(
          index,
          index +
            STAGING_BATCH_SIZE
        ),
      ],
      "inherit"
    );
  }

  if (files.length === 0) {
    return;
  }

  await runGit(
    processRunner,
    projectRoot,
    [
      "commit",
      "-m",
      "Initial commit",
    ],
    "inherit"
  );
}

async function runGit(
  processRunner:
    SafeProcessRunner,
  cwd: string,
  args: string[],
  output:
    "capture" | "inherit"
): Promise<SafeProcessResult> {
  return processRunner({
    command: "git",
    args,
    cwd,
    output,
    timeoutMs:
      GIT_TIMEOUT_MS,
  });
}
