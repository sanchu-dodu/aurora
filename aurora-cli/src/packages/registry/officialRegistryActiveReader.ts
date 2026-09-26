import {
  createHash,
} from "node:crypto";

import {
  constants as fsConstants,
} from "node:fs";

import type {
  Stats,
} from "node:fs";

import fs from "node:fs/promises";

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
  canonicalizeJson,
} from "../trust/packageCanonicalJson.js";

import {
  parseOfficialRegistryActivationReceipt,
} from "./officialRegistryReleaseActivation.js";

import type {
  OfficialRegistryActivationReceipt,
} from "./officialRegistryReleaseActivation.js";

import type {
  OfficialRegistrySnapshot,
} from "./officialRegistrySchema.js";

import {
  OfficialRegistryVerifier,
} from "./officialRegistryVerifier.js";

import type {
  OfficialRegistryVerifierOptions,
  VerifiedOfficialRegistrySnapshot,
} from "./officialRegistryVerifier.js";

const CURRENT_FILE_NAME =
  "current.json";

const SNAPSHOT_FILE_NAME =
  "snapshot.json";

const HISTORY_FILE_NAME =
  "history.json";

const ACTIVATION_FILE_NAME =
  "activation.json";

const MAX_RECEIPT_BYTES =
  4096;

const MAX_SNAPSHOT_BYTES =
  16 * 1024 * 1024;

const MAX_HISTORY_BYTES =
  16 * 1024 * 1024;

const MAX_HISTORY_SNAPSHOTS =
  10_000;

const authenticActiveRegistries =
  new WeakSet<object>();

export interface OfficialRegistryActiveReaderOptions {
  readonly workspaceRoot: string;
  readonly registryDirectory?: string;
  readonly expectedSnapshotDigest?: string;
  readonly registryVerifierOptions?:
    OfficialRegistryVerifierOptions;
}

export interface VerifiedActiveOfficialRegistry {
  readonly source:
    "verified-active-official-registry";
  readonly receipt:
    OfficialRegistryActivationReceipt;
  readonly current:
    VerifiedOfficialRegistrySnapshot;
  readonly previous?:
    VerifiedOfficialRegistrySnapshot;
  readonly history:
    readonly OfficialRegistrySnapshot[];
  readonly generationPath: string;
}

function activeStateFailure(
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Active official registry state is invalid: ${message}`,
    {
      code:
        ErrorCodes
          .REGISTRY_ACTIVE_STATE_INVALID,
      suggestion:
        "Restore an exact activation generation and its canonical current pointer, then retry.",
      cause,
    }
  );
}

function sha256(
  value: Uint8Array
): string {
  return createHash(
    "sha256"
  )
    .update(value)
    .digest("hex");
}

function canonicalBytes(
  value: unknown
): Buffer {
  return Buffer.from(
    `${canonicalizeJson(
      value
    )}\n`,
    "utf8"
  );
}

function sameFileIdentity(
  left: Stats,
  right: Stats
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

async function readBoundedRegularFile(
  file: string,
  maximumBytes: number,
  name: string
): Promise<Buffer> {
  let handle:
    fs.FileHandle |
    undefined;

  try {
    handle =
      await fs.open(
        file,
        process.platform ===
          "win32"
          ? "r"
          : fsConstants.O_RDONLY |
            fsConstants.O_NOFOLLOW |
            fsConstants.O_NONBLOCK
      );

    const before =
      await handle.stat();

    const pathBefore =
      await fs.lstat(
        file
      );

    if (
      !before.isFile() ||
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      !sameFileIdentity(
        before,
        pathBefore
      ) ||
      before.size <= 0 ||
      before.size > maximumBytes
    ) {
      throw activeStateFailure(
        `${name} is not a bounded regular file.`
      );
    }

    // Limit allocation and reads even if the file grows after stat.
    const buffer = Buffer.alloc(before.size + 1);
    let bytesRead = 0;

    while (bytesRead < buffer.length) {
      const result = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead
      );

      if (result.bytesRead === 0) {
        break;
      }

      bytesRead += result.bytesRead;
    }

    const after =
      await handle.stat();

    const pathAfter =
      await fs.lstat(
        file
      );

    if (
      !sameFileIdentity(
        before,
        after
      ) ||
      !sameFileIdentity(
        after,
        pathAfter
      ) ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      bytesRead !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !==
        after.mtimeMs ||
      before.ctimeMs !==
        after.ctimeMs
    ) {
      throw activeStateFailure(
        `${name} changed while it was being read.`
      );
    }

    return buffer.subarray(0, bytesRead);
  }
  finally {
    await handle?.close();
  }
}

function parseCanonicalJson(
  bytes: Buffer,
  name: string
): unknown {
  let value: unknown;

  try {
    value = JSON.parse(
      bytes.toString(
        "utf8"
      )
    );
  }
  catch (error) {
    throw activeStateFailure(
      `${name} is not valid UTF-8 JSON.`,
      error
    );
  }

  let canonical: Buffer;

  try {
    canonical =
      canonicalBytes(
        value
      );
  }
  catch (error) {
    throw activeStateFailure(
      `${name} is not canonical JSON.`,
      error
    );
  }

  if (!bytes.equals(canonical)) {
    throw activeStateFailure(
      `${name} is not the exact canonical JSON encoding.`
    );
  }

  return value;
}

function assertExactEntries(
  actual: readonly string[],
  expected: readonly string[],
  name: string
): void {
  if (
    actual.length !==
      expected.length ||
    actual.some(
      (
        entry,
        index
      ) =>
        entry !==
          expected[index]
    )
  ) {
    throw activeStateFailure(
      `${name} contains missing or unexpected entries.`
    );
  }
}

export function assertVerifiedActiveOfficialRegistry(
  value: unknown
): asserts value is
  VerifiedActiveOfficialRegistry {
  if (
    value === null ||
    typeof value !==
      "object" ||
    !authenticActiveRegistries.has(
      value as object
    )
  ) {
    throw activeStateFailure(
      "the supplied registry was not produced by the active registry reader."
    );
  }
}

export class OfficialRegistryActiveReader {
  private readonly workspaceBoundary:
    ProjectPathBoundary;

  private readonly registryDirectory:
    string;

  private readonly verifierOptions:
    OfficialRegistryVerifierOptions;

  private readonly expectedSnapshotDigest:
    string | undefined;

  constructor(
    options:
      OfficialRegistryActiveReaderOptions
  ) {
    this.workspaceBoundary =
      new ProjectPathBoundary(
        options.workspaceRoot
      );

    this.registryDirectory =
      options.registryDirectory ??
      ".aurora/official-registry";

    this.verifierOptions =
      options.registryVerifierOptions ??
      {};

    this.expectedSnapshotDigest =
      options.expectedSnapshotDigest;

    Object.freeze(this);
  }

  async read(): Promise<
    VerifiedActiveOfficialRegistry
  > {
    try {
      return await this.readVerified();
    }
    catch (error) {
      if (
        error instanceof
          AuroraError &&
        error.code ===
          ErrorCodes
            .REGISTRY_ACTIVE_STATE_INVALID
      ) {
        throw error;
      }

      throw activeStateFailure(
        "the selected generation could not be authenticated.",
        error
      );
    }
  }

  private async readVerified(): Promise<
    VerifiedActiveOfficialRegistry
  > {
    if (
      this.expectedSnapshotDigest !== undefined &&
      (
        typeof this.expectedSnapshotDigest !== "string" ||
        !/^[a-f0-9]{64}$/u.test(this.expectedSnapshotDigest)
      )
    ) {
      throw activeStateFailure(
        "the expected registry digest must be a lowercase SHA-256 digest."
      );
    }

    const registryRoot =
      this.workspaceBoundary.resolve(
        this.registryDirectory
      );

    const rootInformation =
      await fs.lstat(
        registryRoot
      );

    if (
      rootInformation.isSymbolicLink() ||
      !rootInformation.isDirectory()
    ) {
      throw activeStateFailure(
        "the registry root is not a safe directory."
      );
    }

    assertExactEntries(
      (
        await fs.readdir(
          registryRoot
        )
      ).sort(),
      [
        CURRENT_FILE_NAME,
        "generations",
      ],
      "the active registry root"
    );

    const registryBoundary =
      new ProjectPathBoundary(
        registryRoot
      );

    const pointerBytes =
      await readBoundedRegularFile(
        registryBoundary.resolve(
          CURRENT_FILE_NAME
        ),
        MAX_RECEIPT_BYTES,
        "current.json"
      );

    const receipt =
      parseOfficialRegistryActivationReceipt(
        parseCanonicalJson(
          pointerBytes,
          "current.json"
        )
      );

    const generationPath =
      registryBoundary.resolve(
        `generations/${receipt.sequence}/${receipt.snapshotDigest}`
      );

    const generationInformation =
      await fs.lstat(
        generationPath
      );

    if (
      generationInformation
        .isSymbolicLink() ||
      !generationInformation
        .isDirectory()
    ) {
      throw activeStateFailure(
        "the selected generation is not a safe directory."
      );
    }

    assertExactEntries(
      (
        await fs.readdir(
          generationPath
        )
      ).sort(),
      [
        ACTIVATION_FILE_NAME,
        HISTORY_FILE_NAME,
        SNAPSHOT_FILE_NAME,
      ],
      "the selected generation"
    );

    const generationBoundary =
      new ProjectPathBoundary(
        generationPath
      );

    const [
      activationBytes,
      historyBytes,
      snapshotBytes,
    ] =
      await Promise.all([
        readBoundedRegularFile(
          generationBoundary.resolve(
            ACTIVATION_FILE_NAME
          ),
          MAX_RECEIPT_BYTES,
          "activation.json"
        ),
        readBoundedRegularFile(
          generationBoundary.resolve(
            HISTORY_FILE_NAME
          ),
          MAX_HISTORY_BYTES,
          "history.json"
        ),
        readBoundedRegularFile(
          generationBoundary.resolve(
            SNAPSHOT_FILE_NAME
          ),
          MAX_SNAPSHOT_BYTES,
          "snapshot.json"
        ),
      ]);

    if (
      !activationBytes.equals(
        pointerBytes
      )
    ) {
      throw activeStateFailure(
        "the selected activation receipt does not match current.json."
      );
    }

    const activationReceipt =
      parseOfficialRegistryActivationReceipt(
        parseCanonicalJson(
          activationBytes,
          "activation.json"
        )
      );

    if (
      !canonicalBytes(
        activationReceipt
      ).equals(
        pointerBytes
      )
    ) {
      throw activeStateFailure(
        "the activation receipt identity is inconsistent."
      );
    }

    const historyValue =
      parseCanonicalJson(
        historyBytes,
        "history.json"
      );

    if (
      !Array.isArray(
        historyValue
      ) ||
      historyValue.length === 0 ||
      historyValue.length >
        MAX_HISTORY_SNAPSHOTS ||
      historyValue.length !==
        receipt.historyLength
    ) {
      throw activeStateFailure(
        "history.json is not the complete bounded history named by the activation receipt."
      );
    }

    if (
      sha256(
        historyBytes
      ) !==
        receipt.historyDigest
    ) {
      throw activeStateFailure(
        "history.json does not match the activation history digest."
      );
    }

    const expectedPredecessorHistoryDigest =
      historyValue.length === 1
        ? null
        : sha256(
            canonicalBytes(
              historyValue.slice(
                0,
                -1
              )
            )
          );

    if (
      expectedPredecessorHistoryDigest !==
        receipt.predecessorHistoryDigest
    ) {
      throw activeStateFailure(
        "the predecessor history digest is inconsistent."
      );
    }

    parseCanonicalJson(
      snapshotBytes,
      "snapshot.json"
    );

    const lastHistorySnapshot =
      historyValue.at(-1);

    if (
      lastHistorySnapshot ===
        undefined ||
      !snapshotBytes.equals(
        canonicalBytes(
          lastHistorySnapshot
        )
      )
    ) {
      throw activeStateFailure(
        "snapshot.json is not the final snapshot in history.json."
      );
    }

    const verifier =
      new OfficialRegistryVerifier(
        this.verifierOptions
      );

    let previous:
      VerifiedOfficialRegistrySnapshot |
      undefined;

    let current:
      VerifiedOfficialRegistrySnapshot |
      undefined;

    const verifiedHistory:
      OfficialRegistrySnapshot[] = [];

    for (
      const snapshot
      of historyValue
    ) {
      previous = current;

      current =
        verifier.verify(
          snapshot,
          current
        );

      verifiedHistory.push(
        current.snapshot
      );
    }

    if (
      current === undefined ||
      current.digest !==
        receipt.snapshotDigest ||
      current.snapshot.sequence !==
        receipt.sequence ||
      current.snapshot
        .previousSnapshotDigest !==
        receipt.previousSnapshotDigest ||
      receipt.historyLength !==
        receipt.sequence
    ) {
      throw activeStateFailure(
        "the cryptographically verified current snapshot does not match its activation receipt."
      );
    }

    if (
      this.expectedSnapshotDigest !== undefined &&
      current.digest !== this.expectedSnapshotDigest
    ) {
      throw activeStateFailure(
        "the active snapshot does not match the expected registry digest."
      );
    }

    const latestPointerBytes = await readBoundedRegularFile(
      this.workspaceBoundary.resolve(
        `${this.registryDirectory}/${CURRENT_FILE_NAME}`
      ),
      MAX_RECEIPT_BYTES,
      "current.json"
    );

    if (!latestPointerBytes.equals(pointerBytes)) {
      throw activeStateFailure(
        "the active pointer changed during verification; retry resolution."
      );
    }

    const active =
      Object.freeze({
        source:
          "verified-active-official-registry" as const,
        receipt,
        current,
        previous,
        history:
          Object.freeze(
            verifiedHistory
          ),
        generationPath,
      });

    authenticActiveRegistries.add(
      active
    );

    return active;
  }
}
