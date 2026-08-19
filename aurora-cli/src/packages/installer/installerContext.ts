import fs from "node:fs/promises";
import path from "node:path";

import { ConfigContext } from "./configContext.js";
import { EnvContext } from "./envContext.js";
import { TransactionManager } from "./transactionManager.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import {
  redactText,
} from "../../security/secretRedactor.js";

import type {
  PackageOwnershipRecorder,
} from "../state/packageOwnershipRecorder.js";

export class InstallerContext {
  public readonly transaction:
    TransactionManager;

  public readonly config:
    ConfigContext;

  public readonly env:
    EnvContext;

  private readonly pathBoundary:
    ProjectPathBoundary;

  constructor(
    projectPath: string,
    transaction?:
      TransactionManager,
    private readonly ownershipRecorder?:
      PackageOwnershipRecorder
  ) {
    this.pathBoundary =
      new ProjectPathBoundary(
        projectPath
      );

    this.transaction =
      transaction ??
      new TransactionManager(
        "package installation",
        this.pathBoundary.projectRoot
      );

    this.config =
      new ConfigContext(
        this.pathBoundary,
        this.transaction,
        this.ownershipRecorder
      );

    this.env =
      new EnvContext(
        this.pathBoundary,
        this.transaction,
        this.ownershipRecorder
      );
  }

  createPackageScope(
    ownershipRecorder:
      PackageOwnershipRecorder
  ): InstallerContext {
    return new InstallerContext(
      this.pathBoundary.projectRoot,
      this.transaction,
      ownershipRecorder
    );
  }

  getProjectPath(): string {
    return this.pathBoundary
      .projectRoot;
  }

  resolveProjectPath(
    relativePath: string
  ): string {
    return this.pathBoundary
      .resolve(relativePath);
  }

  log(message: string): void {
    console.log(
      redactText(message)
    );
  }

  async createFile(
    filePath: string,
    content: string
  ): Promise<void> {
    const fullPath =
      this.resolveProjectPath(
        filePath
      );

    await this.ownershipRecorder
      ?.recordFileBefore(
        filePath
      );

    await this.transaction
      .recordModifiedFile(
        fullPath
      );

    await fs.mkdir(
      path.dirname(fullPath),
      {
        recursive: true,
      }
    );

    await fs.writeFile(
      this.resolveProjectPath(
        filePath
      ),
      content,
      "utf8"
    );

    console.log(
      `Created ${filePath}`
    );
  }
}