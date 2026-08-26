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
  VerifiedPackagePublicationBuilder,
} from "../publish/packagePublicationBundle.js";

import type {
  PackageTrustPolicyOptions,
} from "../trust/packageTrustPolicy.js";

import {
  isCanonicalPackageIdentifier,
} from "../manifestSchema.js";

import {
  OfficialRegistryReleaseProposalBuilder,
  OfficialRegistryReleaseProposalWriter,
} from "./officialRegistryReleaseProposal.js";

import type {
  VerifiedOfficialRegistryReleaseProposal,
  WrittenOfficialRegistryReleaseProposal,
} from "./officialRegistryReleaseProposal.js";

import {
  OfficialRegistryVerifier,
} from "./officialRegistryVerifier.js";

import type {
  OfficialRegistryVerifierOptions,
  VerifiedOfficialRegistrySnapshot,
} from "./officialRegistryVerifier.js";

const MAX_REGISTRY_HISTORY_BYTES =
  16 * 1024 * 1024;

const MAX_REGISTRY_HISTORY_SNAPSHOTS =
  10_000;

export interface ProposeOfficialRegistryReleaseOptions {
  readonly registryHistory: string;
  readonly archiveUrl: string;
  readonly publishedAt: string;
  readonly dryRun?: boolean;
}

export interface OfficialRegistryReleaseCommandDependencies {
  readonly workspaceRoot?: string;
  readonly publicationTrust?:
    PackageTrustPolicyOptions;
  readonly registryVerifierOptions?:
    OfficialRegistryVerifierOptions;
  readonly signingKeyId?: string;
  readonly proposalDirectory?: string;
}

export interface ProposedOfficialRegistryRelease {
  readonly proposal:
    VerifiedOfficialRegistryReleaseProposal;
  readonly written?:
    WrittenOfficialRegistryReleaseProposal;
}

function commandFailure(
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official registry release proposal failed: ${message}`,
    {
      code:
        ErrorCodes
          .REGISTRY_RELEASE_PROPOSAL_FAILED,
      suggestion:
        "Provide an in-workspace registry history ordered from genesis through the current signed snapshot.",
      cause,
    }
  );
}

async function readRegistryHistory(
  workspaceBoundary:
    ProjectPathBoundary,
  historyPath: string
): Promise<readonly unknown[]> {
  const candidate =
    isAbsolute(historyPath)
      ? historyPath
      : resolve(
          workspaceBoundary
            .projectRoot,
          historyPath
        );

  const verifiedPath =
    workspaceBoundary
      .validateAbsolutePath(
        candidate
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
      before.size >
        MAX_REGISTRY_HISTORY_BYTES
    ) {
      throw commandFailure(
        "the registry history is not a bounded regular file."
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
      before.size !==
        after.size ||
      before.mtimeMs !==
        after.mtimeMs ||
      before.ctimeMs !==
        after.ctimeMs
    ) {
      throw commandFailure(
        "the registry history changed while it was being read."
      );
    }

    let history: unknown;

    try {
      history = JSON.parse(
        content.toString(
          "utf8"
        )
      );
    }
    catch (error) {
      throw commandFailure(
        "the registry history is not valid JSON.",
        error
      );
    }

    if (
      !Array.isArray(history) ||
      history.length === 0 ||
      history.length >
        MAX_REGISTRY_HISTORY_SNAPSHOTS
    ) {
      throw commandFailure(
        "the registry history must be a non-empty bounded JSON array."
      );
    }

    return history;
  }
  finally {
    await handle?.close();
  }
}

function verifyRegistryHistory(
  history:
    readonly unknown[],
  verifier:
    OfficialRegistryVerifier
): VerifiedOfficialRegistrySnapshot {
  let previous:
    VerifiedOfficialRegistrySnapshot |
    undefined;

  for (const snapshot of history) {
    previous =
      verifier.verify(
        snapshot,
        previous
      );
  }

  if (previous === undefined) {
    throw commandFailure(
      "the registry history did not contain a signed snapshot."
    );
  }

  return previous;
}

export async function proposeOfficialRegistryRelease(
  packageId: string,
  options:
    ProposeOfficialRegistryReleaseOptions,
  dependencies:
    OfficialRegistryReleaseCommandDependencies = {}
): Promise<
  ProposedOfficialRegistryRelease
> {
  if (
    packageId.length > 128 ||
    !isCanonicalPackageIdentifier(
      packageId
    )
  ) {
    throw new AuroraError(
      `Package id '${packageId}' is not canonical.`,
      {
        code:
          ErrorCodes
            .INVALID_PACKAGE_MANIFEST,
        suggestion:
          "Use a lowercase package id containing only letters, numbers, dots, or hyphens.",
      }
    );
  }

  const workspaceBoundary =
    new ProjectPathBoundary(
      dependencies
        .workspaceRoot ??
      process.cwd()
    );

  const history =
    await readRegistryHistory(
      workspaceBoundary,
      options.registryHistory
    );

  const predecessor =
    verifyRegistryHistory(
      history,
      new OfficialRegistryVerifier(
        dependencies
          .registryVerifierOptions
      )
    );

  const packagePath =
    workspaceBoundary.resolve(
      `packages/${packageId}`
    );

  const publication =
    await new VerifiedPackagePublicationBuilder({
      trust:
        dependencies
          .publicationTrust,
    }).build(
      packagePath
    );

  const proposal =
    new OfficialRegistryReleaseProposalBuilder()
      .build(
        predecessor,
        publication,
        {
          archiveUrl:
            options.archiveUrl,
          publishedAt:
            options.publishedAt,
          signingKeyId:
            dependencies
              .signingKeyId,
        }
      );

  console.log();
  console.log(
    "Verified official registry release proposal."
  );
  console.log(
    `Package: ${proposal.document.publication.packageId}@${proposal.document.publication.version}`
  );
  console.log(
    `Registry sequence: ${proposal.document.unsignedSnapshot.sequence}`
  );
  console.log(
    `Signing payload digest: ${proposal.document.signing.payload.digest}`
  );

  if (options.dryRun) {
    console.log(
      "Dry run: no registry proposal files were written."
    );

    return {
      proposal,
    };
  }

  const written =
    await new OfficialRegistryReleaseProposalWriter({
      workspaceRoot:
        workspaceBoundary
          .projectRoot,
      proposalDirectory:
        dependencies
          .proposalDirectory,
    }).write(
      proposal
    );

  console.log(
    `Proposal: ${written.proposalFile}`
  );
  console.log(
    `Signing payload: ${written.signingPayloadFile}`
  );

  return {
    proposal,
    written,
  };
}
