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
  OfficialRegistryReleaseFinalizer,
  OfficialRegistryReleaseWriter,
} from "./officialRegistryReleaseFinalizer.js";

import type {
  VerifiedOfficialRegistryRelease,
  WrittenOfficialRegistryRelease,
} from "./officialRegistryReleaseFinalizer.js";

import {
  readOfficialRegistryHistory,
  verifyOfficialRegistryHistory,
} from "./officialRegistryReleaseCommand.js";

import {
  OfficialRegistryVerifier,
} from "./officialRegistryVerifier.js";

import type {
  OfficialRegistryVerifierOptions,
} from "./officialRegistryVerifier.js";

const MAX_PROPOSAL_BYTES =
  4 * 1024 * 1024;

const MAX_SIGNING_PAYLOAD_BYTES =
  4 * 1024 * 1024;

const MAX_SIGNATURE_FILE_BYTES =
  128;

export interface FinalizeOfficialRegistryReleaseOptions {
  readonly registryHistory: string;
  readonly signature: string;
  readonly dryRun?: boolean;
}

export interface OfficialRegistryReleaseFinalizationCommandDependencies {
  readonly workspaceRoot?: string;
  readonly registryVerifierOptions?:
    OfficialRegistryVerifierOptions;
  readonly releaseDirectory?: string;
}

export interface FinalizedOfficialRegistryRelease {
  readonly release:
    VerifiedOfficialRegistryRelease;
  readonly written?:
    WrittenOfficialRegistryRelease;
}

function commandFailure(
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official registry release finalization failed: ${message}`,
    {
      code:
        ErrorCodes
          .REGISTRY_RELEASE_FINALIZATION_FAILED,
      suggestion:
        "Use an in-workspace canonical proposal directory, signature file, and complete signed registry history.",
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

async function readBoundedRegularFile(
  boundary:
    ProjectPathBoundary,
  path: string,
  maximumBytes: number,
  name: string
): Promise<Buffer> {
  const verifiedPath =
    resolveWorkspacePath(
      boundary,
      path
    );

  let handle:
    fs.FileHandle |
    undefined;

  try {
    handle =
      await fs.open(
        verifiedPath,
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
        verifiedPath
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
      before.size > maximumBytes
    ) {
      throw commandFailure(
        `${name} is not a bounded regular file.`
      );
    }

    const content =
      await handle.readFile();

    const after =
      await handle.stat();

    const pathAfter =
      await fs.lstat(
        verifiedPath
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
        `${name} changed while it was being read.`
      );
    }

    return content;
  }
  finally {
    await handle?.close();
  }
}

async function readProposalDirectory(
  workspaceBoundary:
    ProjectPathBoundary,
  proposalPath: string
): Promise<{
  readonly value: unknown;
  readonly proposalBytes: Buffer;
  readonly signingPayload: Buffer;
}> {
  const directory =
    resolveWorkspacePath(
      workspaceBoundary,
      proposalPath
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
      "the proposal path is not a safe directory."
    );
  }

  const proposalBoundary =
    new ProjectPathBoundary(
      directory
    );

  const entries =
    (
      await fs.readdir(
        proposalBoundary
          .projectRoot
      )
    ).sort();

  if (
    entries.length !== 2 ||
    entries[0] !==
      "proposal.json" ||
    entries[1] !==
      "registry-signing-payload.bin"
  ) {
    throw commandFailure(
      "the proposal directory must contain exactly proposal.json and registry-signing-payload.bin."
    );
  }

  const [
    proposalBytes,
    signingPayload,
  ] =
    await Promise.all([
      readBoundedRegularFile(
        proposalBoundary,
        "proposal.json",
        MAX_PROPOSAL_BYTES,
        "proposal.json"
      ),
      readBoundedRegularFile(
        proposalBoundary,
        "registry-signing-payload.bin",
        MAX_SIGNING_PAYLOAD_BYTES,
        "registry-signing-payload.bin"
      ),
    ]);

  let value: unknown;

  try {
    value = JSON.parse(
      proposalBytes.toString(
        "utf8"
      )
    );
  }
  catch (error) {
    throw commandFailure(
      "proposal.json is not valid UTF-8 JSON.",
      error
    );
  }

  return {
    value,
    proposalBytes,
    signingPayload,
  };
}

async function readCanonicalSignature(
  workspaceBoundary:
    ProjectPathBoundary,
  signaturePath: string
): Promise<string> {
  const bytes =
    await readBoundedRegularFile(
      workspaceBoundary,
      signaturePath,
      MAX_SIGNATURE_FILE_BYTES,
      "signature file"
    );

  const value =
    bytes.toString(
      "utf8"
    );

  if (
    !value.endsWith("\n") ||
    value.slice(0, -1)
      .includes("\n") ||
    Buffer.from(
      value,
      "utf8"
    ).byteLength !==
      bytes.byteLength
  ) {
    throw commandFailure(
      "the signature file must contain one canonical base64url signature followed by one LF."
    );
  }

  return value.slice(
    0,
    -1
  );
}

export async function finalizeOfficialRegistryRelease(
  proposalPath: string,
  options:
    FinalizeOfficialRegistryReleaseOptions,
  dependencies:
    OfficialRegistryReleaseFinalizationCommandDependencies = {}
): Promise<
  FinalizedOfficialRegistryRelease
> {
  const workspaceBoundary =
    new ProjectPathBoundary(
      dependencies
        .workspaceRoot ??
      process.cwd()
    );

  const history =
    await readOfficialRegistryHistory(
      workspaceBoundary,
      options.registryHistory
    );

  const predecessor =
    verifyOfficialRegistryHistory(
      history,
      new OfficialRegistryVerifier(
        dependencies
          .registryVerifierOptions
      )
    );

  const proposal =
    await readProposalDirectory(
      workspaceBoundary,
      proposalPath
    );

  const signature =
    await readCanonicalSignature(
      workspaceBoundary,
      options.signature
    );

  const release =
    new OfficialRegistryReleaseFinalizer({
      registryVerifierOptions:
        dependencies
          .registryVerifierOptions,
    }).finalize(
      predecessor,
      proposal.value,
      proposal.proposalBytes,
      proposal.signingPayload,
      signature
    );

  console.log();
  console.log(
    "Verified official registry signed release."
  );
  console.log(
    `Registry sequence: ${release.snapshot.sequence}`
  );
  console.log(
    `Registry digest: ${release.digest}`
  );

  if (options.dryRun) {
    console.log(
      "Dry run: no signed registry release files were written."
    );

    return {
      release,
    };
  }

  const written =
    await new OfficialRegistryReleaseWriter({
      workspaceRoot:
        workspaceBoundary
          .projectRoot,
      releaseDirectory:
        dependencies
          .releaseDirectory,
    }).write(
      release
    );

  console.log(
    `Signed snapshot: ${written.snapshotFile}`
  );

  return {
    release,
    written,
  };
}
