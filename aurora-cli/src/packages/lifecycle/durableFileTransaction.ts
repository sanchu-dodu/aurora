import fs from "node:fs/promises";
import path from "node:path";

import {
  FileTransaction,
} from "../../core/fileTransaction.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import type {
  LifecycleJournal,
  LifecycleJournalOperation,
} from "./lifecycleJournalSchema.js";

import {
  LifecycleJournalStore,
} from "./lifecycleJournalStore.js";

export interface BeginDurableFileTransactionInput {
  readonly operationName:
    string;

  readonly operation:
    LifecycleJournalOperation;

  readonly packageIds:
    readonly string[];

  readonly projectPath:
    string;

  readonly transactionId?:
    string;

  readonly timestamp?:
    string;
}

export class DurableFileTransaction
  extends FileTransaction {
  private readonly projectBoundary:
    ProjectPathBoundary;

  /*
   * Base FileTransaction.rollback() finishes by calling
   * this.commit(). DurableFileTransaction deliberately
   * rejects that ordinary synchronous commit path.
   *
   * The exact sentinel allows rollback() to distinguish
   * that expected terminal call from any genuine rollback
   * failure without ever opening a window in which an
   * external synchronous commit could succeed.
   */
  private readonly synchronousCommitError =
    new Error(
      "DurableFileTransaction.commit() cannot bypass the durable journal. Use await commitDurably()."
    );

  private closed =
    false;

  private constructor(
    operationName: string,
    projectPath: string,
    private readonly journalStore:
      LifecycleJournalStore,
    private readonly lifecycleTransactionId:
      string
  ) {
    super(
      operationName,
      projectPath
    );

    this.projectBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  static async begin(
    input:
      BeginDurableFileTransactionInput
  ): Promise<
    DurableFileTransaction
  > {
    if (
      !input.operationName.trim()
    ) {
      throw new TypeError(
        "Durable file transaction operation name cannot be empty."
      );
    }

    const journalStore =
      new LifecycleJournalStore(
        input.projectPath
      );

    const journal =
      await journalStore.create({
        transactionId:
          input.transactionId,

        operation:
          input.operation,

        packageIds:
          input.packageIds,

        timestamp:
          input.timestamp,
      });

    return new DurableFileTransaction(
      input.operationName,
      input.projectPath,
      journalStore,
      journal.transactionId
    );
  }

  get transactionId():
    string {
    return this
      .lifecycleTransactionId;
  }

  async readJournal():
    Promise<LifecycleJournal> {
    return this.journalStore
      .read(
        this.lifecycleTransactionId
      );
  }

  /*
   * recordCreatedFile() is synchronous in the legacy
   * FileTransaction API. Durable rollback evidence cannot
   * safely be persisted from that synchronous surface.
   *
   * Future lifecycle callers must therefore use the
   * already-existing awaited recordModifiedFile() path
   * before creating a new file. FileTransaction represents
   * a missing file as rollback state correctly.
   */
  override recordCreatedFile(
    _file: string
  ): void {
    this.assertOpen();

    throw new Error(
      "DurableFileTransaction.recordCreatedFile() is unsafe because it cannot persist rollback evidence asynchronously. Use await recordModifiedFile() before creating the file."
    );
  }

  override async recordModifiedFile(
    file: string
  ): Promise<void> {
    this.assertOpen();

    const target =
      this.projectFile(
        file
      );

    /*
     * Persist the before-image first. If the later RAM
     * snapshot fails, the project has not been mutated and
     * the durable journal conservatively remains incomplete.
     */
    await this.journalStore
      .captureFileBeforeImage(
        this.lifecycleTransactionId,
        target.relativePath
      );

    await super.recordModifiedFile(
      target.absolutePath
    );
  }

  override async recordDirectoryMode(
    directory: string
  ): Promise<void> {
    this.assertOpen();

    const target =
      this.projectDirectory(
        directory
      );

    await this.journalStore
      .captureDirectoryBeforeImage(
        this.lifecycleTransactionId,
        target.relativePath
      );

    await super.recordDirectoryMode(
      target.absolutePath
    );
  }

  override async ensureDirectory(
    directory: string
  ): Promise<void> {
    this.assertOpen();

    const resolvedDirectory =
      this.projectBoundary
        .validateAbsolutePath(
          path.resolve(
            directory
          ),
          true
        );

    if (
      resolvedDirectory ===
      this.projectBoundary
        .projectRoot
    ) {
      return;
    }

    /*
     * ensureDirectory() itself mutates the filesystem.
     * Unlike recordModifiedFile(), it is therefore forbidden
     * while the durable transaction is merely prepared.
     */
    const journal =
      await this.readJournal();

    if (
      journal.phase !==
        "mutating"
    ) {
      throw new Error(
        `DurableFileTransaction.ensureDirectory() requires journal phase 'mutating'; current phase is '${journal.phase}'.`
      );
    }

    /*
     * Persist every missing directory before FileTransaction
     * recursively creates the chain. This mirrors the RAM
     * createdDirectories rollback evidence durably.
     */
    await this
      .captureMissingDirectories(
        resolvedDirectory
      );

    await super.ensureDirectory(
      resolvedDirectory
    );
  }

  async beginMutation():
    Promise<LifecycleJournal> {
    this.assertOpen();

    return this.journalStore
      .transition(
        this.lifecycleTransactionId,
        "mutating"
      );
  }

  async beginVerification():
    Promise<LifecycleJournal> {
    this.assertOpen();

    return this.journalStore
      .transition(
        this.lifecycleTransactionId,
        "verifying"
      );
  }

  /*
   * The COMMITTED record is made durable before RAM rollback
   * evidence is discarded. A process death after the durable
   * transition therefore cannot make an incomplete operation
   * look recoverable.
   */
  async commitDurably():
    Promise<LifecycleJournal> {
    this.assertOpen();

    const committed =
      await this.journalStore
        .transition(
          this.lifecycleTransactionId,
          "committed"
        );

    super.commit();

    this.closed =
      true;

    return committed;
  }

  /*
   * Never permit legacy callers to silently bypass the
   * durable journal with synchronous commit().
   */
  override commit():
    void {
    this.assertOpen();

    throw this
      .synchronousCommitError;
  }

  /*
   * Handled rollback continues to use the proven in-memory
   * FileTransaction restoration behavior.
   *
   * The lifecycle journal deliberately remains incomplete.
   * A future automatic recovery layer can therefore replay
   * the same before-images idempotently after interruption.
   */
  override async rollback():
    Promise<void> {
    this.assertOpen();

    try {
      await super.rollback();
    }
    catch (error) {
      /*
       * Base rollback restores every resource first and then
       * calls this.commit(). Our override rejects precisely
       * that final synchronous commit. Suppress only our
       * private sentinel; propagate every other failure.
       */
      if (
        error !==
        this.synchronousCommitError
      ) {
        throw error;
      }
    }

    /*
     * RAM evidence may be discarded after handled rollback.
     * The durable journal is intentionally not transitioned
     * to committed.
     */
    super.commit();

    this.closed =
      true;
  }

  private projectFile(
    file: string
  ): {
    readonly absolutePath:
      string;

    readonly relativePath:
      string;
  } {
    const absolutePath =
      this.projectBoundary
        .validateAbsolutePath(
          path.resolve(
            file
          )
        );

    return {
      absolutePath,

      relativePath:
        this.toJournalRelativePath(
          absolutePath
        ),
    };
  }

  private projectDirectory(
    directory: string
  ): {
    readonly absolutePath:
      string;

    readonly relativePath:
      string;
  } {
    const absolutePath =
      this.projectBoundary
        .validateAbsolutePath(
          path.resolve(
            directory
          ),
          true
        );

    /*
     * Lifecycle Journal v1 intentionally represents only
     * project-relative child resources, never the root.
     */
    if (
      absolutePath ===
      this.projectBoundary
        .projectRoot
    ) {
      throw new Error(
        "DurableFileTransaction cannot journal the project root directory itself."
      );
    }

    return {
      absolutePath,

      relativePath:
        this.toJournalRelativePath(
          absolutePath
        ),
    };
  }

  private toJournalRelativePath(
    absolutePath: string
  ): string {
    const relativePath =
      path.relative(
        this.projectBoundary
          .projectRoot,
        absolutePath
      );

    if (
      !relativePath
    ) {
      throw new Error(
        "DurableFileTransaction cannot journal the project root itself."
      );
    }

    /*
     * Lifecycle Journal v1 stores canonical POSIX relative
     * paths even when Aurora is running on Windows.
     */
    return relativePath
      .split(path.sep)
      .join("/");
  }

  private async captureMissingDirectories(
    resolvedDirectory: string
  ): Promise<void> {
    const missingDirectories:
      string[] = [];

    let current =
      resolvedDirectory;

    while (
      current !==
      this.projectBoundary
        .projectRoot
    ) {
      try {
        const information =
          await fs.lstat(
            current
          );

        if (
          information
            .isSymbolicLink() ||
          !information
            .isDirectory()
        ) {
          throw new Error(
            `Path is not a regular directory: ${current}`
          );
        }

        break;
      }
      catch (error) {
        const code =
          (
            error as
              NodeJS.ErrnoException
          ).code;

        if (
          code !==
          "ENOENT"
        ) {
          throw error;
        }

        missingDirectories
          .push(
            current
          );

        current =
          path.dirname(
            current
          );
      }
    }

    /*
     * Capture parent-first. Journal normalization remains
     * deterministic independently of insertion order.
     */
    for (
      const missingDirectory of
      missingDirectories
        .reverse()
    ) {
      await this.journalStore
        .captureDirectoryBeforeImage(
          this.lifecycleTransactionId,
          this.toJournalRelativePath(
            missingDirectory
          )
        );
    }
  }

  private assertOpen():
    void {
    if (
      this.closed
    ) {
      throw new Error(
        "Durable file transaction is already closed."
      );
    }
  }
}