import fs from "node:fs/promises";
import path from "node:path";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  WriteLock,
} from "../synchronization/writeLock.js";

import {
  PACKAGE_STATE_MAX_BYTES,
  createEmptyPackageState,
  parsePackageState,
  parsePackageStateReceipt,
  type PackageState,
  type PackageStateReceipt,
} from "./packageStateSchema.js";

export const PACKAGE_STATE_RELATIVE_PATH =
  ".aurora/package-state.json";

export class PackageStateStore {
  private readonly pathBoundary:
    ProjectPathBoundary;

  private readonly lock =
    new WriteLock();

  constructor(
    projectPath: string
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  private get stateFile(): string {
    return this.pathBoundary.resolve(
      PACKAGE_STATE_RELATIVE_PATH
    );
  }

  async read():
    Promise<PackageState> {
    await this.lock.acquire();

    try {
      return await this
        .readUnlocked();
    }
    finally {
      this.lock.release();
    }
  }

  async write(
    state: PackageState
  ): Promise<void> {
    await this.lock.acquire();

    try {
      await this.writeUnlocked(
        state
      );
    }
    finally {
      this.lock.release();
    }
  }

  async getReceipt(
    packageId: string
  ): Promise<
    PackageStateReceipt |
    undefined
  > {
    const state =
      await this.read();

    return state.packages[
      packageId
    ];
  }

  async upsertReceipt(
    receiptInput:
      PackageStateReceipt
  ): Promise<void> {
    const receipt =
      parsePackageStateReceipt(
        receiptInput
      );

    await this.lock.acquire();

    try {
      const state =
        await this.readUnlocked();

      await this.writeUnlocked({
        schemaVersion:
          state.schemaVersion,

        packages: {
          ...state.packages,

          [receipt.id]:
            receipt,
        },
      });
    }
    finally {
      this.lock.release();
    }
  }

  private async readUnlocked():
    Promise<PackageState> {
    let content: string;

    try {
      content =
        await fs.readFile(
          this.stateFile,
          "utf8"
        );
    }
    catch (error) {
      const code =
        (
          error as
            NodeJS.ErrnoException
        ).code;

      if (code === "ENOENT") {
        return createEmptyPackageState();
      }

      throw error;
    }

    if (
      Buffer.byteLength(
        content,
        "utf8"
      ) >
      PACKAGE_STATE_MAX_BYTES
    ) {
      throw new TypeError(
        "Aurora package state exceeds the maximum supported size."
      );
    }

    let decoded: unknown;

    try {
      decoded =
        JSON.parse(content);
    }
    catch {
      throw new TypeError(
        "Aurora package state contains invalid JSON."
      );
    }

    return parsePackageState(
      decoded
    );
  }

  private async writeUnlocked(
    stateInput: PackageState
  ): Promise<void> {
    const state =
      normalizePackageState(
        parsePackageState(
          stateInput
        )
      );

    const serialized =
      `${JSON.stringify(
        state,
        null,
        2
      )}\n`;

    if (
      Buffer.byteLength(
        serialized,
        "utf8"
      ) >
      PACKAGE_STATE_MAX_BYTES
    ) {
      throw new TypeError(
        "Aurora package state exceeds the maximum supported size."
      );
    }

    const stateFile =
      this.stateFile;

    await fs.mkdir(
      path.dirname(
        stateFile
      ),
      {
        recursive: true,
      }
    );

    /*
     * Re-resolve immediately before mutation so
     * ProjectPathBoundary gets another opportunity
     * to reject a path that became unsafe.
     */
    const revalidatedStateFile =
      this.stateFile;

    await fs.writeFile(
      revalidatedStateFile,
      serialized,
      {
        encoding: "utf8",
        mode: 0o600,
      }
    );
  }
}

function normalizePackageState(
  state: PackageState
): PackageState {
  const packages:
    Record<
      string,
      PackageStateReceipt
    > = {};

  const packageIds =
    Object.keys(
      state.packages
    ).sort(compareText);

  for (
    const packageId of packageIds
  ) {
    const receipt =
      state.packages[
        packageId
      ];

    packages[packageId] = {
      ...receipt,

      files:
        [...receipt.files]
          .sort(
            (left, right) =>
              compareText(
                left.path,
                right.path
              )
          ),

      dependencies:
        [...receipt.dependencies]
          .sort(
            (left, right) =>
              compareText(
                left.name,
                right.name
              )
          ),

      environment:
        [...receipt.environment]
          .sort(
            (left, right) =>
              compareText(
                left.name,
                right.name
              )
          ),
    };
  }

  return {
    schemaVersion:
      state.schemaVersion,

    packages,
  };
}

function compareText(
  left: string,
  right: string
): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}