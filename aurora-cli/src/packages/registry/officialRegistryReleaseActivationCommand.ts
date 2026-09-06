import {
  constants as fsConstants,
} from "node:fs";

import fs from "node:fs/promises";

import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  AuroraError,
} from "../../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../../errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  OfficialRegistryActivationStore,
  OfficialRegistryReleaseActivator,
} from "./officialRegistryReleaseActivation.js";

import type {
  VerifiedOfficialRegistryActivation,
  WrittenOfficialRegistryActivation,
} from "./officialRegistryReleaseActivation.js";

import {
  readOfficialRegistryHistory,
} from "./officialRegistryReleaseCommand.js";

import type {
  OfficialRegistryVerifierOptions,
} from "./officialRegistryVerifier.js";

const MAX_FINALIZED_SNAPSHOT_BYTES =
  16 * 1024 * 1024;

export interface ActivateOfficialRegistryReleaseOptions {
  readonly registryHistory: string;
  readonly dryRun?: boolean;
}

export interface OfficialRegistryReleaseActivationCommandDependencies {
  readonly workspaceRoot?: string;
  readonly registryVerifierOptions?:
    OfficialRegistryVerifierOptions;
  readonly registryDirectory?: string;
}

export interface ActivatedOfficialRegistryRelease {
  readonly activation:
    VerifiedOfficialRegistryActivation;
  readonly written?:
    WrittenOfficialRegistryActivation;
}

function commandFailure(
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official registry release activation failed: ${message}`,
    {
      code:
        ErrorCodes
          .REGISTRY_RELEASE_ACTIVATION_FAILED,
      suggestion:
        "Use an in-workspace finalized release directory and the complete signed predecessor history.",
      cause,
    }
  );
}

function resolveWorkspacePath(
  boundary:
    ProjectPathBoundary,
  value: string
): string {
  const candidate =
    isAbsolute(value)
      ? value
      : resolve(
          boundary.projectRoot,
          value
        );

  return boundary
    .validateAbsolutePath(
      candidate
    );
}

async function readFinalizedRelease(
  workspaceBoundary:
    ProjectPathBoundary,
  releasePath: string
): Promise<{
  readonly value: unknown;
  readonly bytes: Buffer;
}> {
  const directory =
    resolveWorkspacePath(
      workspaceBoundary,
      releasePath
    );

  const information =
    await fs.lstat(
      directory
    );

  if (
    information.isSymbolicLink() ||
    !information.isDirectory()
  ) {
    throw commandFailure(
      "the finalized release path is not a safe directory."
    );
  }

  const entries =
    (
      await fs.readdir(
        directory
      )
    ).sort();

  if (
    entries.length !== 1 ||
    entries[0] !==
      "snapshot.json"
  ) {
    throw commandFailure(
      "the finalized release directory must contain exactly snapshot.json."
    );
  }

  const releaseBoundary =
    new ProjectPathBoundary(
      directory
    );

  const snapshotFile =
    releaseBoundary.resolve(
      "snapshot.json"
    );

  let handle:
    fs.FileHandle |
    undefined;

  try {
    handle =
      await fs.open(
        snapshotFile,
        process.platform ===
          "win32"
          ? "r"
          : fsConstants.O_RDONLY |
            fsConstants.O_NOFOLLOW
      );

    const before =
      await handle.stat();

    const pathBefore =
      await fs.lstat(
        snapshotFile
      );

    if (
      !before.isFile() ||
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      before.dev !==
        pathBefore.dev ||
      before.ino !==
        pathBefore.ino ||
      before.size <= 0 ||
      before.size >
        MAX_FINALIZED_SNAPSHOT_BYTES
    ) {
      throw commandFailure(
        "snapshot.json is not a bounded regular file."
      );
    }

    const bytes =
      await handle.readFile();

    const after =
      await handle.stat();

    const pathAfter =
      await fs.lstat(
        snapshotFile
      );

    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      after.dev !==
        pathAfter.dev ||
      after.ino !==
        pathAfter.ino ||
      before.size !== after.size ||
      before.mtimeMs !==
        after.mtimeMs ||
      before.ctimeMs !==
        after.ctimeMs
    ) {
      throw commandFailure(
        "snapshot.json changed while it was being read."
      );
    }

    let value: unknown;

    try {
      value = JSON.parse(
        bytes.toString(
          "utf8"
        )
      );
    }
    catch (error) {
      throw commandFailure(
        "snapshot.json is not valid UTF-8 JSON.",
        error
      );
    }

    return {
      value,
      bytes,
    };
  }
  finally {
    await handle?.close();
  }
}

export async function activateOfficialRegistryRelease(
  releasePath: string,
  options:
    ActivateOfficialRegistryReleaseOptions,
  dependencies:
    OfficialRegistryReleaseActivationCommandDependencies = {}
): Promise<
  ActivatedOfficialRegistryRelease
> {
  try {
    const workspaceBoundary =
      new ProjectPathBoundary(
        dependencies
          .workspaceRoot ??
        process.cwd()
      );

    const [
      history,
      release,
    ] =
      await Promise.all([
        readOfficialRegistryHistory(
          workspaceBoundary,
          options.registryHistory
        ),
        readFinalizedRelease(
          workspaceBoundary,
          releasePath
        ),
      ]);

    const activation =
      new OfficialRegistryReleaseActivator({
        registryVerifierOptions:
          dependencies
            .registryVerifierOptions,
      }).prepare(
        history,
        release.value,
        release.bytes
      );

    console.log();
    console.log(
      "Verified official registry activation candidate."
    );
    console.log(
      `Registry sequence: ${activation.receipt.sequence}`
    );
    console.log(
      `Registry digest: ${activation.digest}`
    );
    console.log(
      `Authenticated history digest: ${activation.receipt.historyDigest}`
    );

    if (options.dryRun) {
      console.log(
        "Dry run: the live official registry pointer was not changed."
      );

      return {
        activation,
      };
    }

    const written =
      await new OfficialRegistryActivationStore({
        workspaceRoot:
          workspaceBoundary
            .projectRoot,
        registryDirectory:
          dependencies
            .registryDirectory,
      }).activate(
        activation
      );

    console.log(
      written.reused
        ? "The exact registry generation is already active."
        : "Activated the authenticated registry generation."
    );
    console.log(
      `Current pointer: ${written.currentFile}`
    );
    console.log(
      `Authenticated history: ${written.historyFile}`
    );

    return {
      activation,
      written,
    };
  }
  catch (error) {
    if (
      error instanceof
        AuroraError &&
      error.code ===
        ErrorCodes
          .REGISTRY_RELEASE_ACTIVATION_FAILED
    ) {
      throw error;
    }

    throw commandFailure(
      "the finalized snapshot or its predecessor history could not be authenticated.",
      error
    );
  }
}
