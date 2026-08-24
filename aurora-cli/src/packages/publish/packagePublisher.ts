import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import type {
  PackageTrustPolicyOptions,
} from "../trust/packageTrustPolicy.js";

import {
  PackagePublicationWriter,
  VerifiedPackagePublicationBuilder,
} from "./packagePublicationBundle.js";

import type {
  PackagePublicationReceipt,
  PublishedPackageBundle,
  VerifiedPackagePublicationBundle,
} from "./packagePublicationBundle.js";

export interface PackagePublisherOptions {
  readonly workspaceRoot: string;
  readonly publicationDirectory?: string;
  readonly trust?:
    PackageTrustPolicyOptions;
  readonly maxInputBytes?: number;
}

export class PackagePublisher {
  private readonly workspaceBoundary:
    ProjectPathBoundary;

  private readonly builder:
    VerifiedPackagePublicationBuilder;

  private readonly writer:
    PackagePublicationWriter;

  constructor(
    options:
      PackagePublisherOptions
  ) {
    this.workspaceBoundary =
      new ProjectPathBoundary(
        options.workspaceRoot
      );

    this.builder =
      new VerifiedPackagePublicationBuilder({
        trust:
          options.trust,
        maxInputBytes:
          options.maxInputBytes,
      });

    this.writer =
      new PackagePublicationWriter({
        workspaceRoot:
          options.workspaceRoot,
        publicationDirectory:
          options.publicationDirectory,
      });

    Object.freeze(this);
  }

  async publish(
    packagePath: string
  ): Promise<
    PublishedPackageBundle
  > {
    const bundle =
      await this.build(
        packagePath
      );

    const published =
      await this.writer
        .write(bundle);

    console.log();
    console.log(
      "Verified publication bundle created."
    );
    console.log(
      `Package: ${published.receipt.packageId}@${published.receipt.version}`
    );
    console.log(
      `Archive: ${published.archivePath}`
    );
    console.log(
      `Receipt: ${published.receiptPath}`
    );

    return published;
  }

  async prepare(
    packagePath: string
  ): Promise<
    PackagePublicationReceipt
  > {
    const bundle =
      await this.build(
        packagePath
      );

    console.log();
    console.log(
      "Verified publication bundle preview."
    );
    console.log(
      `Package: ${bundle.receipt.packageId}@${bundle.receipt.version}`
    );
    console.log(
      `Archive digest: ${bundle.receipt.archive.digest}`
    );
    console.log(
      `Archive size: ${bundle.receipt.archive.size} bytes`
    );
    console.log(
      "Dry run: no publication files were written."
    );

    return bundle.receipt;
  }

  private async build(
    packagePath: string
  ): Promise<
    VerifiedPackagePublicationBundle
  > {
    const candidate =
      isAbsolute(packagePath)
        ? packagePath
        : resolve(
            this.workspaceBoundary
              .projectRoot,
            packagePath
          );

    const verifiedPackagePath =
      this.workspaceBoundary
        .validateAbsolutePath(
          candidate
        );

    return this.builder
      .build(
        verifiedPackagePath
      );
  }
}
