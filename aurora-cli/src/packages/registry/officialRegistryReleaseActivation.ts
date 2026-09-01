import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  constants as fsConstants,
} from "node:fs";

import type {
  Stats,
} from "node:fs";

import fs from "node:fs/promises";

import {
  dirname,
  join,
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
  durableCreateDirectory,
  durableEnsureDirectory,
  durableWriteFile,
  syncDirectory,
} from "../lifecycle/durableFileWriter.js";

import {
  ProjectLifecycleLock,
} from "../lifecycle/projectLifecycleLock.js";

import {
  canonicalizeJson,
} from "../trust/packageCanonicalJson.js";

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

export const OFFICIAL_REGISTRY_ACTIVATION_KIND =
  "aurora.official-registry-activation";

export const OFFICIAL_REGISTRY_ACTIVATION_VERSION =
  1;

const SNAPSHOT_FILE_NAME =
  "snapshot.json";

const HISTORY_FILE_NAME =
  "history.json";

const ACTIVATION_FILE_NAME =
  "activation.json";

const CURRENT_FILE_NAME =
  "current.json";

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/u;

const MAX_HISTORY_SNAPSHOTS =
  10_000;

const MAX_ACTIVATION_RECEIPT_BYTES =
  4096;

const authenticActivations =
  new WeakSet<object>();

export interface OfficialRegistryActivationReceipt {
  readonly kind:
    typeof OFFICIAL_REGISTRY_ACTIVATION_KIND;
  readonly schemaVersion:
    typeof OFFICIAL_REGISTRY_ACTIVATION_VERSION;
  readonly sequence: number;
  readonly snapshotDigest: string;
  readonly previousSnapshotDigest:
    string | null;
  readonly historyDigest: string;
  readonly predecessorHistoryDigest:
    string | null;
  readonly historyLength: number;
}

export interface VerifiedOfficialRegistryActivation {
  readonly source:
    "verified-official-registry-activation";
  readonly snapshot:
    OfficialRegistrySnapshot;
  readonly digest: string;
  readonly history:
    readonly OfficialRegistrySnapshot[];
  readonly receipt:
    OfficialRegistryActivationReceipt;
  readonly predecessorReceipt:
    OfficialRegistryActivationReceipt;
  readonly snapshotBytes:
    () => Buffer;
  readonly historyBytes:
    () => Buffer;
  readonly predecessorHistoryBytes:
    () => Buffer;
  readonly receiptBytes:
    () => Buffer;
  readonly predecessorReceiptBytes:
    () => Buffer;
  readonly predecessorSnapshotBytes:
    () => Buffer;
}

export interface OfficialRegistryReleaseActivatorOptions {
  readonly registryVerifierOptions?:
    OfficialRegistryVerifierOptions;
}

export interface OfficialRegistryActivationStoreOptions {
  readonly workspaceRoot: string;
  readonly registryDirectory?: string;
}

export interface WrittenOfficialRegistryActivation {
  readonly receipt:
    OfficialRegistryActivationReceipt;
  readonly generationPath: string;
  readonly snapshotFile: string;
  readonly historyFile: string;
  readonly activationFile: string;
  readonly currentFile: string;
  readonly reused: boolean;
}

function activationFailure(
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
        "Use an exact finalized release, the complete authenticated predecessor history, and an untampered local registry state.",
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

function isMissing(
  error: unknown
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function createReceipt(
  history:
    readonly OfficialRegistrySnapshot[],
  digests:
    readonly string[]
): OfficialRegistryActivationReceipt {
  const snapshot =
    history.at(-1);

  const digest =
    digests.at(-1);

  if (
    snapshot === undefined ||
    digest === undefined
  ) {
    throw activationFailure(
      "an activation receipt requires a non-empty verified history."
    );
  }

  const historyBytes =
    canonicalBytes(
      history
    );

  const predecessorHistoryDigest =
    history.length === 1
      ? null
      : sha256(
          canonicalBytes(
            history.slice(
              0,
              -1
            )
          )
        );

  return Object.freeze({
    kind:
      OFFICIAL_REGISTRY_ACTIVATION_KIND,
    schemaVersion:
      OFFICIAL_REGISTRY_ACTIVATION_VERSION,
    sequence:
      snapshot.sequence,
    snapshotDigest:
      digest,
    previousSnapshotDigest:
      snapshot
        .previousSnapshotDigest,
    historyDigest:
      sha256(
        historyBytes
      ),
    predecessorHistoryDigest,
    historyLength:
      history.length,
  });
}

function assertReceiptShape(
  value: unknown
): asserts value is
  OfficialRegistryActivationReceipt {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw activationFailure(
      "the current activation pointer is not a strict object."
    );
  }

  const record =
    value as Record<
      string,
      unknown
    >;

  const expectedKeys = [
    "historyDigest",
    "historyLength",
    "kind",
    "predecessorHistoryDigest",
    "previousSnapshotDigest",
    "schemaVersion",
    "sequence",
    "snapshotDigest",
  ];

  const actualKeys =
    Object.keys(record)
      .sort();

  if (
    actualKeys.length !==
      expectedKeys.length ||
    actualKeys.some(
      (
        key,
        index
      ) =>
        key !==
          expectedKeys[index]
    )
  ) {
    throw activationFailure(
      "the current activation pointer has missing or unexpected fields."
    );
  }

  const digestOrNull =
    (
      digest: unknown
    ): boolean =>
      digest === null ||
      (
        typeof digest ===
          "string" &&
        SHA256_PATTERN.test(
          digest
        )
      );

  if (
    record.kind !==
      OFFICIAL_REGISTRY_ACTIVATION_KIND ||
    record.schemaVersion !==
      OFFICIAL_REGISTRY_ACTIVATION_VERSION ||
    !Number.isSafeInteger(
      record.sequence
    ) ||
    (
      record.sequence as number
    ) <= 0 ||
    !Number.isSafeInteger(
      record.historyLength
    ) ||
    record.historyLength !==
      record.sequence ||
    typeof record.snapshotDigest !==
      "string" ||
    !SHA256_PATTERN.test(
      record.snapshotDigest
    ) ||
    typeof record.historyDigest !==
      "string" ||
    !SHA256_PATTERN.test(
      record.historyDigest
    ) ||
    !digestOrNull(
      record.previousSnapshotDigest
    ) ||
    !digestOrNull(
      record.predecessorHistoryDigest
    ) ||
    (
      record.sequence === 1
        ? record.previousSnapshotDigest !==
            null ||
          record.predecessorHistoryDigest !==
            null
        : record.previousSnapshotDigest ===
            null ||
          record.predecessorHistoryDigest ===
            null
    )
  ) {
    throw activationFailure(
      "the current activation pointer is invalid."
    );
  }
}

async function readExactRegularFile(
  file: string,
  expected: Buffer,
  name: string
): Promise<void> {
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
            fsConstants.O_NOFOLLOW
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
      before.size !==
        expected.byteLength
    ) {
      throw activationFailure(
        `${name} is not the expected regular file.`
      );
    }

    const content =
      await handle.readFile();

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
      before.size !== after.size ||
      before.mtimeMs !==
        after.mtimeMs ||
      before.ctimeMs !==
        after.ctimeMs ||
      !content.equals(
        expected
      )
    ) {
      throw activationFailure(
        `${name} does not match the authenticated activation bytes.`
      );
    }
  }
  finally {
    await handle?.close();
  }
}

async function readCurrentReceipt(
  currentFile: string
): Promise<{
  readonly receipt:
    OfficialRegistryActivationReceipt;
  readonly bytes: Buffer;
} | undefined> {
  let handle:
    fs.FileHandle |
    undefined;

  let bytes: Buffer;

  try {
    handle =
      await fs.open(
        currentFile,
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
        currentFile
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
      before.size >
        MAX_ACTIVATION_RECEIPT_BYTES
    ) {
      throw activationFailure(
        "the current activation pointer is not a bounded regular file."
      );
    }

    bytes =
      await handle.readFile();

    const after =
      await handle.stat();

    const pathAfter =
      await fs.lstat(
        currentFile
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
      before.size !== after.size ||
      before.mtimeMs !==
        after.mtimeMs ||
      before.ctimeMs !==
        after.ctimeMs
    ) {
      throw activationFailure(
        "the current activation pointer changed while it was being read."
      );
    }
  }
  catch (error) {
    if (isMissing(error)) {
      return undefined;
    }

    throw error;
  }
  finally {
    await handle?.close();
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
    throw activationFailure(
      "the current activation pointer is not valid JSON.",
      error
    );
  }

  assertReceiptShape(
    value
  );

  const canonical =
    canonicalBytes(
      value
    );

  if (!bytes.equals(canonical)) {
    throw activationFailure(
      "the current activation pointer is not canonical."
    );
  }

  return {
    receipt:
      Object.freeze(value),
    bytes,
  };
}

export function assertVerifiedOfficialRegistryActivation(
  value: unknown
): asserts value is
  VerifiedOfficialRegistryActivation {
  if (
    value === null ||
    typeof value !==
      "object" ||
    !authenticActivations.has(
      value as object
    )
  ) {
    throw activationFailure(
      "the supplied activation was not produced by the official registry release activator."
    );
  }
}

export class OfficialRegistryReleaseActivator {
  private readonly verifierOptions:
    OfficialRegistryVerifierOptions;

  constructor(
    options:
      OfficialRegistryReleaseActivatorOptions = {}
  ) {
    this.verifierOptions =
      options.registryVerifierOptions ??
      {};

    Object.freeze(this);
  }

  prepare(
    predecessorHistory:
      readonly unknown[],
    releaseValue: unknown,
    releaseBytes: Uint8Array
  ): VerifiedOfficialRegistryActivation {
    try {
      return this.prepareVerified(
        predecessorHistory,
        releaseValue,
        releaseBytes
      );
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

      throw activationFailure(
        "the finalized snapshot or its predecessor history could not be authenticated.",
        error
      );
    }
  }

  private prepareVerified(
    predecessorHistory:
      readonly unknown[],
    releaseValue: unknown,
    releaseBytes: Uint8Array
  ): VerifiedOfficialRegistryActivation {
    if (
      !Array.isArray(
        predecessorHistory
      ) ||
      predecessorHistory.length === 0 ||
      predecessorHistory.length >=
        MAX_HISTORY_SNAPSHOTS
    ) {
      throw activationFailure(
        "the predecessor history must be a non-empty bounded array with room for one successor."
      );
    }

    const verifier =
      new OfficialRegistryVerifier(
        this.verifierOptions
      );

    let previous:
      VerifiedOfficialRegistrySnapshot |
      undefined;

    const verifiedHistory:
      OfficialRegistrySnapshot[] = [];

    const verifiedDigests:
      string[] = [];

    for (
      const snapshot
      of predecessorHistory
    ) {
      previous =
        verifier.verify(
          snapshot,
          previous
        );

      verifiedHistory.push(
        previous.snapshot
      );

      verifiedDigests.push(
        previous.digest
      );
    }

    if (previous === undefined) {
      throw activationFailure(
        "the predecessor history did not contain a signed snapshot."
      );
    }

    const release =
      verifier.verify(
        releaseValue,
        previous
      );

    const snapshotBytes =
      canonicalBytes(
        release.snapshot
      );

    if (
      !snapshotBytes.equals(
        Buffer.from(
          releaseBytes
        )
      )
    ) {
      throw activationFailure(
        "the finalized release is not the exact canonical signed snapshot."
      );
    }

    const predecessorHistoryBytes =
      canonicalBytes(
        verifiedHistory
      );

    const predecessorReceipt =
      createReceipt(
        verifiedHistory,
        verifiedDigests
      );

    const completeHistory =
      Object.freeze([
        ...verifiedHistory,
        release.snapshot,
      ]);

    const completeDigests = [
      ...verifiedDigests,
      release.digest,
    ];

    const historyBytes =
      canonicalBytes(
        completeHistory
      );

    const receipt =
      createReceipt(
        completeHistory,
        completeDigests
      );

    const activation =
      Object.freeze({
        source:
          "verified-official-registry-activation" as const,
        snapshot:
          release.snapshot,
        digest:
          release.digest,
        history:
          completeHistory,
        receipt,
        predecessorReceipt,
        snapshotBytes:
          () =>
            Buffer.from(
              snapshotBytes
            ),
        historyBytes:
          () =>
            Buffer.from(
              historyBytes
            ),
        predecessorHistoryBytes:
          () =>
            Buffer.from(
              predecessorHistoryBytes
            ),
        receiptBytes:
          () =>
            canonicalBytes(
              receipt
            ),
        predecessorReceiptBytes:
          () =>
            canonicalBytes(
              predecessorReceipt
            ),
        predecessorSnapshotBytes:
          () =>
            canonicalBytes(
              previous.snapshot
            ),
      });

    authenticActivations.add(
      activation
    );

    return activation;
  }
}

export class OfficialRegistryActivationStore {
  private readonly workspaceBoundary:
    ProjectPathBoundary;

  private readonly registryDirectory:
    string;

  constructor(
    options:
      OfficialRegistryActivationStoreOptions
  ) {
    this.workspaceBoundary =
      new ProjectPathBoundary(
        options.workspaceRoot
      );

    this.registryDirectory =
      options.registryDirectory ??
      ".aurora/official-registry";

    Object.freeze(this);
  }

  async activate(
    value: unknown
  ): Promise<
    WrittenOfficialRegistryActivation
  > {
    assertVerifiedOfficialRegistryActivation(
      value
    );

    const lock =
      await ProjectLifecycleLock.acquire(
        this.workspaceBoundary
          .projectRoot
      );

    try {
      return await this.activateLocked(
        value
      );
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

      throw activationFailure(
        "the authenticated registry generation could not be activated atomically.",
        error
      );
    }
    finally {
      await lock.release();
    }
  }

  private async activateLocked(
    value:
      VerifiedOfficialRegistryActivation
  ): Promise<
    WrittenOfficialRegistryActivation
  > {
    const registryRoot =
      this.workspaceBoundary.resolve(
        this.registryDirectory
      );

    await durableEnsureDirectory(
      registryRoot
    );

    const registryBoundary =
      new ProjectPathBoundary(
        registryRoot
      );

    const currentFile =
      registryBoundary.resolve(
        CURRENT_FILE_NAME
      );

    const current =
      await readCurrentReceipt(
        currentFile
      );

    const rootEntries =
      (
        await fs.readdir(
          registryRoot
        )
      ).sort();

    if (
      current === undefined
        ? rootEntries.length !== 0
        : rootEntries.length !== 2 ||
          rootEntries[0] !==
            CURRENT_FILE_NAME ||
          rootEntries[1] !==
            "generations"
    ) {
      throw activationFailure(
        current === undefined
          ? "a non-empty registry store is missing its authoritative current pointer."
          : "the active registry store contains unexpected root entries."
      );
    }

    let reused = false;

    if (current !== undefined) {
      const candidateBytes =
        value.receiptBytes();

      if (
        current.bytes.equals(
          candidateBytes
        )
      ) {
        await this.verifyGeneration(
          registryBoundary,
          value.receipt,
          value.snapshotBytes(),
          value.historyBytes(),
          candidateBytes
        );

        reused = true;
      }
      else {
        const predecessorBytes =
          value
            .predecessorReceiptBytes();

        if (
          !current.bytes.equals(
            predecessorBytes
          )
        ) {
          throw activationFailure(
            "the candidate does not advance exactly from the locally active registry generation."
          );
        }

        await this.verifyGeneration(
          registryBoundary,
          value.predecessorReceipt,
          value.predecessorSnapshotBytes(),
          value.predecessorHistoryBytes(),
          predecessorBytes
        );
      }
    }

    const generationPath =
      await this.writeGeneration(
        registryBoundary,
        value
      );

    if (!reused) {
      const latest =
        await readCurrentReceipt(
          currentFile
        );

      if (
        current === undefined
          ? latest !== undefined
          : latest === undefined ||
            !latest.bytes.equals(
              current.bytes
            )
      ) {
        throw activationFailure(
          "the local registry pointer changed during activation."
        );
      }

      await durableWriteFile(
        currentFile,
        value.receiptBytes()
      );

      await readExactRegularFile(
        currentFile,
        value.receiptBytes(),
        "current activation pointer"
      );
    }

    return Object.freeze({
      receipt:
        value.receipt,
      generationPath,
      snapshotFile:
        join(
          generationPath,
          SNAPSHOT_FILE_NAME
        ),
      historyFile:
        join(
          generationPath,
          HISTORY_FILE_NAME
        ),
      activationFile:
        join(
          generationPath,
          ACTIVATION_FILE_NAME
        ),
      currentFile,
      reused,
    });
  }

  private generationPath(
    boundary:
      ProjectPathBoundary,
    receipt:
      OfficialRegistryActivationReceipt
  ): string {
    return boundary.resolve(
      `generations/${receipt.sequence}/${receipt.snapshotDigest}`
    );
  }

  private async verifyGeneration(
    boundary:
      ProjectPathBoundary,
    receipt:
      OfficialRegistryActivationReceipt,
    snapshotBytes: Buffer,
    historyBytes: Buffer,
    receiptBytes: Buffer
  ): Promise<void> {
    const generationPath =
      this.generationPath(
        boundary,
        receipt
      );

    const entries =
      (
        await fs.readdir(
          generationPath
        )
      ).sort();

    if (
      entries.length !== 3 ||
      entries[0] !==
        ACTIVATION_FILE_NAME ||
      entries[1] !==
        HISTORY_FILE_NAME ||
      entries[2] !==
        SNAPSHOT_FILE_NAME
    ) {
      throw activationFailure(
        "the active registry generation contains unexpected files."
      );
    }

    await Promise.all([
      readExactRegularFile(
        join(
          generationPath,
          SNAPSHOT_FILE_NAME
        ),
        snapshotBytes,
        "generation snapshot"
      ),
      readExactRegularFile(
        join(
          generationPath,
          HISTORY_FILE_NAME
        ),
        historyBytes,
        "generation history"
      ),
      readExactRegularFile(
        join(
          generationPath,
          ACTIVATION_FILE_NAME
        ),
        receiptBytes,
        "generation activation receipt"
      ),
    ]);
  }

  private async writeGeneration(
    boundary:
      ProjectPathBoundary,
    value:
      VerifiedOfficialRegistryActivation
  ): Promise<string> {
    const finalPath =
      this.generationPath(
        boundary,
        value.receipt
      );

    try {
      await this.verifyGeneration(
        boundary,
        value.receipt,
        value.snapshotBytes(),
        value.historyBytes(),
        value.receiptBytes()
      );

      return finalPath;
    }
    catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }

    await durableEnsureDirectory(
      dirname(finalPath)
    );

    const stagingPath =
      boundary.resolve(
        `.registry-activation-${process.pid}-${randomUUID()}.tmp`
      );

    let stagingCreated =
      false;

    try {
      await durableCreateDirectory(
        stagingPath
      );

      stagingCreated = true;

      await Promise.all([
        durableWriteFile(
          join(
            stagingPath,
            SNAPSHOT_FILE_NAME
          ),
          value.snapshotBytes()
        ),
        durableWriteFile(
          join(
            stagingPath,
            HISTORY_FILE_NAME
          ),
          value.historyBytes()
        ),
        durableWriteFile(
          join(
            stagingPath,
            ACTIVATION_FILE_NAME
          ),
          value.receiptBytes()
        ),
      ]);

      try {
        await fs.rename(
          stagingPath,
          finalPath
        );

        stagingCreated =
          false;

        await syncDirectory(
          dirname(finalPath)
        );
      }
      catch (error) {
        if (
          !(
            typeof error ===
              "object" &&
            error !== null &&
            "code" in error &&
            (
              error.code ===
                "EEXIST" ||
              error.code ===
                "ENOTEMPTY" ||
              error.code ===
                "EPERM"
            )
          )
        ) {
          throw error;
        }

        await this.verifyGeneration(
          boundary,
          value.receipt,
          value.snapshotBytes(),
          value.historyBytes(),
          value.receiptBytes()
        );
      }

      return finalPath;
    }
    finally {
      if (stagingCreated) {
        try {
          await fs.rm(
            boundary
              .validateAbsolutePath(
                stagingPath
              ),
            {
              recursive: true,
              force: true,
            }
          );
        }
        catch {
          // Preserve the primary activation failure.
        }
      }
    }
  }
}
