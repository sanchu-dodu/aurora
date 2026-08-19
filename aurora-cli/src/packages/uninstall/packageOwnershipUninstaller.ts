import {
  createHash,
} from "node:crypto";

import type {
  Stats,
} from "node:fs";

import fs from "node:fs/promises";

import {
  FileTransaction,
} from "../../core/fileTransaction.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import type {
  PackageState,
  PackageStateReceipt,
} from "../state/packageStateSchema.js";

type JsonObject =
  Record<string, unknown>;

export interface PackageOwnershipUninstallPlan {
  readonly packageId:
    string;

  readonly files:
    readonly PackageFileUninstallAction[];

  readonly dependencies:
    readonly PackageDependencyUninstallAction[];

  readonly environment:
    readonly PackageEnvironmentUninstallAction[];
}

interface PackageFileUninstallAction {
  readonly path:
    string;

  readonly sha256:
    string;

  /*
   * false means the resource stays in place but must
   * still be revalidated during execution.
   */
  readonly remove:
    boolean;
}

interface PackageDependencyUninstallAction {
  readonly name:
    string;

  readonly currentVersion:
    string;

  /*
   * undefined = preserve current value for another
   * compatible owner.
   *
   * null = remove dependency entirely.
   *
   * string = restore that exact prior version.
   */
  readonly replacementVersion:
    string |
    null |
    undefined;
}

interface PackageEnvironmentUninstallAction {
  readonly name:
    string;

  /*
   * false means another receipt preserves both the
   * marker and its cleanup provenance.
   */
  readonly remove:
    boolean;
}

export class PackageOwnershipUninstaller {
  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(
    projectPath: string,
    private readonly transaction:
      FileTransaction
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );
  }

  createPlan(
    receipt: PackageStateReceipt,
    state: PackageState
  ): PackageOwnershipUninstallPlan {
    const installedReceipt =
      state.packages[
        receipt.id
      ];

    if (!installedReceipt) {
      throw new Error(
        `Cannot uninstall '${receipt.id}' because its ownership receipt is not installed.`
      );
    }

    const remainingReceipts =
      Object.values(
        state.packages
      ).filter(
        candidate =>
          candidate.id !==
          receipt.id
      );

    const files:
      PackageFileUninstallAction[] = [];

    const dependencies:
      PackageDependencyUninstallAction[] = [];

    const environment:
      PackageEnvironmentUninstallAction[] = [];

    for (
      const ownedFile
      of receipt.files
    ) {
      const remainingOwners =
        remainingReceipts
          .flatMap(
            candidate =>
              candidate.files
          )
          .filter(
            candidate =>
              candidate.path ===
              ownedFile.path
          );

      if (
        remainingOwners.length >
        0
      ) {
        const incompatibleOwner =
          remainingOwners.find(
            owner =>
              owner.sha256 !==
              ownedFile.sha256
          );

        if (incompatibleOwner) {
          throw new Error(
            `Cannot safely uninstall '${receipt.id}' because file '${ownedFile.path}' has conflicting remaining ownership.`
          );
        }

        /*
         * A created-file receipt carries the provenance
         * that permits the file to be deleted when its
         * final owner disappears.
         *
         * Do not discard the only such receipt while
         * leaving only "modified" owners behind.
         */
        if (
          ownedFile.action ===
            "created" &&
          !remainingOwners.some(
            owner =>
              owner.action ===
              "created"
          )
        ) {
          throw new Error(
            `Cannot safely uninstall '${receipt.id}' because file '${ownedFile.path}' would lose its creation provenance.`
          );
        }

        files.push({
          path:
            ownedFile.path,

          sha256:
            ownedFile.sha256,

          remove:
            false,
        });

        continue;
      }

      if (
        ownedFile.action ===
        "modified"
      ) {
        throw new Error(
          `Cannot safely uninstall '${receipt.id}' because modified file '${ownedFile.path}' requires previous bytes that are not stored by Package State v1.`
        );
      }

      files.push({
        path:
          ownedFile.path,

        sha256:
          ownedFile.sha256,

        remove:
          true,
      });
    }

    for (
      const dependency
      of receipt.dependencies
    ) {
      const remainingOwners =
        remainingReceipts
          .flatMap(
            candidate =>
              candidate.dependencies
          )
          .filter(
            candidate =>
              candidate.name ===
              dependency.name
          );

      if (
        remainingOwners.length >
        0
      ) {
        const incompatibleOwner =
          remainingOwners.find(
            owner =>
              owner.version !==
              dependency.version
          );

        if (incompatibleOwner) {
          throw new Error(
            `Cannot safely uninstall '${receipt.id}' because dependency '${dependency.name}' has conflicting remaining ownership.`
          );
        }

        /*
         * Preserve not only the current version but also
         * the restoration provenance. Without this gate,
         * uninstalling the package that originally added
         * or changed the dependency could leave a later
         * receipt incapable of restoring package.json.
         */
        /*
         * previousVersion === version means this receipt
         * observed the dependency already at the final
         * version and therefore carries no transition
         * that needs to survive its removal.
         *
         * If this receipt actually changed or introduced
         * the dependency, at least one remaining receipt
         * must preserve that same prior-state transition.
         */
        const carriesTransition =
          dependency.previousVersion !==
          dependency.version;

        if (
          carriesTransition &&
          !remainingOwners.some(
            owner =>
              owner.previousVersion ===
              dependency.previousVersion
          )
        ) {
          throw new Error(
            `Cannot safely uninstall '${receipt.id}' because dependency '${dependency.name}' would lose its restoration provenance.`
          );
        }

        dependencies.push({
          name:
            dependency.name,

          currentVersion:
            dependency.version,

          replacementVersion:
            undefined,
        });

        continue;
      }

      dependencies.push({
        name:
          dependency.name,

        currentVersion:
          dependency.version,

        replacementVersion:
          dependency.previousVersion,
      });
    }

    for (
      const variable
      of receipt.environment
    ) {
      /*
       * introduced:false means this package explicitly
       * does not claim authority to remove the marker.
       */
      if (
        !variable.introduced
      ) {
        continue;
      }

      const remainingOwners =
        remainingReceipts
          .flatMap(
            candidate =>
              candidate.environment
          )
          .filter(
            candidate =>
              candidate.name ===
              variable.name
          );

      if (
        remainingOwners.length >
        0
      ) {
        /*
         * A remaining introduced:true receipt is needed
         * so future uninstall still knows Aurora created
         * this marker. A remaining introduced:false
         * receipt alone cannot inherit deletion authority.
         */
        if (
          !remainingOwners.some(
            owner =>
              owner.introduced
          )
        ) {
          throw new Error(
            `Cannot safely uninstall '${receipt.id}' because environment marker '${variable.name}' would lose its introduction provenance.`
          );
        }

        environment.push({
          name:
            variable.name,

          remove:
            false,
        });

        continue;
      }

      environment.push({
        name:
          variable.name,

        remove:
          true,
      });
    }

    return {
      packageId:
        receipt.id,

      files:
        files.sort(
          (left, right) =>
            compareText(
              left.path,
              right.path
            )
        ),

      dependencies:
        dependencies.sort(
          (left, right) =>
            compareText(
              left.name,
              right.name
            )
        ),

      environment:
        environment.sort(
          (left, right) =>
            compareText(
              left.name,
              right.name
            )
        ),
    };
  }

  async apply(
    plan:
      PackageOwnershipUninstallPlan
  ): Promise<void> {
    /*
     * Preserved shared resources are deliberately part
     * of the plan. They are revalidated during this
     * locked execution instead of relying only on the
     * earlier InstalledStateVerifier pass.
     */
    await this
      .applyDependencies(
        plan
      );

    await this
      .applyEnvironment(
        plan
      );

    await this
      .applyFiles(
        plan
      );
  }

  private async applyDependencies(
    plan:
      PackageOwnershipUninstallPlan
  ): Promise<void> {
    if (
      plan.dependencies.length ===
      0
    ) {
      return;
    }

    const packageJsonPath =
      this.pathBoundary.resolve(
        "package.json"
      );

    const mutates =
      plan.dependencies.some(
        action =>
          action.replacementVersion !==
          undefined
      );

    if (mutates) {
      await this.transaction
        .recordModifiedFile(
          packageJsonPath
        );
    }

    const content =
      await fs.readFile(
        this.pathBoundary.resolve(
          "package.json"
        ),
        "utf8"
      );

    const decoded =
      JSON.parse(
        content
      ) as unknown;

    const packageJson =
      asJsonObject(
        decoded
      );

    if (!packageJson) {
      throw new TypeError(
        "Project package.json must contain a JSON object."
      );
    }

    const dependencies =
      asJsonObject(
        packageJson.dependencies
      );

    if (!dependencies) {
      throw new Error(
        "Cannot safely uninstall package dependencies because package.json dependencies are missing or invalid."
      );
    }

    for (
      const action
      of plan.dependencies
    ) {
      const current =
        dependencies[
          action.name
        ];

      /*
       * This validation is performed for both mutated
       * and preserved shared dependencies.
       */
      if (
        current !==
        action.currentVersion
      ) {
        throw new Error(
          `Cannot safely uninstall dependency '${action.name}' because its current version no longer matches the ownership receipt.`
        );
      }

      if (
        action.replacementVersion ===
        undefined
      ) {
        continue;
      }

      if (
        action.replacementVersion ===
        null
      ) {
        delete dependencies[
          action.name
        ];
      }
      else {
        dependencies[
          action.name
        ] =
          action.replacementVersion;
      }
    }

    if (!mutates) {
      return;
    }

    await fs.writeFile(
      this.pathBoundary.resolve(
        "package.json"
      ),
      JSON.stringify(
        packageJson,
        null,
        2
      ),
      "utf8"
    );
  }

  private async applyEnvironment(
    plan:
      PackageOwnershipUninstallPlan
  ): Promise<void> {
    if (
      plan.environment.length ===
      0
    ) {
      return;
    }

    const environmentPath =
      this.pathBoundary.resolve(
        ".env.example"
      );

    const mutates =
      plan.environment.some(
        action =>
          action.remove
      );

    if (mutates) {
      await this.transaction
        .recordModifiedFile(
          environmentPath
        );
    }

    let content =
      await fs.readFile(
        this.pathBoundary.resolve(
          ".env.example"
        ),
        "utf8"
      );

    for (
      const action
      of plan.environment
    ) {
      const markers =
        countVariableMarkers(
          content,
          action.name
        );

      /*
       * Duplicate markers are ambiguous. Even when the
       * resource is being preserved, do not silently
       * remove ownership from an ambiguous environment
       * state.
       */
      if (
        markers !==
        1
      ) {
        throw new Error(
          `Cannot safely process environment marker '${action.name}' because it is missing or duplicated.`
        );
      }

      if (
        !action.remove
      ) {
        continue;
      }

      const emptyMarkers =
        countExactEmptyMarkers(
          content,
          action.name
        );

      if (
        emptyMarkers !==
        1
      ) {
        throw new Error(
          `Cannot safely remove environment marker '${action.name}' because it contains a value.`
        );
      }

      content =
        removeExactEmptyMarker(
          content,
          action.name
        );
    }

    if (!mutates) {
      return;
    }

    await fs.writeFile(
      this.pathBoundary.resolve(
        ".env.example"
      ),
      content,
      "utf8"
    );
  }

  private async applyFiles(
    plan:
      PackageOwnershipUninstallPlan
  ): Promise<void> {
    for (
      const action
      of plan.files
    ) {
      const fullPath =
        this.pathBoundary.resolve(
          action.path
        );

      if (
        action.remove
      ) {
        await this.transaction
          .recordModifiedFile(
            fullPath
          );
      }

      /*
       * Revalidate every target-owned file, including a
       * shared file that will remain in place.
       */
      const digest =
        await this
          .readStableDigest(
            action.path
          );

      if (
        digest !==
        action.sha256
      ) {
        throw new Error(
          `Cannot safely process owned file '${action.path}' because its current digest no longer matches the ownership receipt.`
        );
      }

      if (
        !action.remove
      ) {
        continue;
      }

      /*
       * Re-resolve immediately before mutation.
       */
      const removalPath =
        this.pathBoundary.resolve(
          action.path
        );

      const information =
        await fs.lstat(
          removalPath
        );

      if (
        information
          .isSymbolicLink() ||
        !information
          .isFile()
      ) {
        throw new Error(
          `Cannot safely remove owned file '${action.path}' because it is no longer a regular file.`
        );
      }

      await fs.unlink(
        removalPath
      );
    }
  }

  private async readStableDigest(
    relativePath: string
  ): Promise<string> {
    const fullPath =
      this.pathBoundary.resolve(
        relativePath
      );

    let handle:
      fs.FileHandle | undefined;

    try {
      handle =
        await fs.open(
          fullPath,
          "r"
        );

      const information =
        await handle.stat();

      const pathInformation =
        await fs.lstat(
          fullPath
        );

      if (
        !information.isFile() ||
        pathInformation
          .isSymbolicLink() ||
        !pathInformation
          .isFile() ||
        !sameFileIdentity(
          information,
          pathInformation
        )
      ) {
        throw new Error(
          `Owned path is not a stable regular file: ${relativePath}`
        );
      }

      const content =
        await handle.readFile();

      const completedInformation =
        await handle.stat();

      if (
        !sameFileIdentity(
          information,
          completedInformation
        ) ||
        fileChangedWhileReading(
          information,
          completedInformation
        )
      ) {
        throw new Error(
          `Owned file changed while uninstall safety was being checked: ${relativePath}`
        );
      }

      const completedPathInformation =
        await fs.lstat(
          fullPath
        );

      if (
        completedPathInformation
          .isSymbolicLink() ||
        !completedPathInformation
          .isFile() ||
        !sameFileIdentity(
          completedInformation,
          completedPathInformation
        )
      ) {
        throw new Error(
          `Owned path changed while uninstall safety was being checked: ${relativePath}`
        );
      }

      return createHash(
        "sha256"
      )
        .update(content)
        .digest("hex");
    }
    finally {
      await handle?.close();
    }
  }
}

function asJsonObject(
  value: unknown
): JsonObject | undefined {
  if (
    typeof value !==
      "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }

  return value as
    JsonObject;
}

function countVariableMarkers(
  content: string,
  name: string
): number {
  const pattern =
    new RegExp(
      `(^|\\n)${name}=`,
      "gu"
    );

  return Array.from(
    content.matchAll(
      pattern
    )
  ).length;
}

function countExactEmptyMarkers(
  content: string,
  name: string
): number {
  const pattern =
    new RegExp(
      `(^|\\n)${name}=(?=\\r?(?:\\n|$))`,
      "gu"
    );

  return Array.from(
    content.matchAll(
      pattern
    )
  ).length;
}

function removeExactEmptyMarker(
  content: string,
  name: string
): string {
  const pattern =
    new RegExp(
      `(^|\\n)${name}=\\r?(?:\\n|$)`,
      "u"
    );

  return content.replace(
    pattern,
    (
      _match,
      prefix: string
    ) =>
      prefix === "\n"
        ? "\n"
        : ""
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

function fileChangedWhileReading(
  before: Stats,
  after: Stats
): boolean {
  return (
    before.size !==
      after.size ||
    before.mtimeMs !==
      after.mtimeMs ||
    before.ctimeMs !==
      after.ctimeMs
  );
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
