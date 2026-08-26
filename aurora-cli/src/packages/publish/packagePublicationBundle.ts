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
  basename,
  dirname,
  join,
} from "node:path";

import {
  gzipSync,
} from "node:zlib";

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
  PackageArtifactVerifier,
} from "../integrity/packageArtifactVerifier.js";

import {
  durableCreateDirectory,
  durableEnsureDirectory,
  durableWriteFile,
  syncDirectory,
} from "../lifecycle/durableFileWriter.js";

import {
  loadManifestDocument,
} from "../manifestLoader.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  canonicalizeJson,
} from "../trust/packageCanonicalJson.js";

import {
  PackageTrustPolicy,
} from "../trust/packageTrustPolicy.js";

import type {
  PackageTrustPolicyOptions,
} from "../trust/packageTrustPolicy.js";

const TAR_BLOCK_BYTES =
  512;

const TAR_NAME_BYTES =
  100;

const TAR_PREFIX_BYTES =
  155;

const ARCHIVE_FILE_NAME =
  "package.tar.gz";

const RECEIPT_FILE_NAME =
  "publication.json";

const GZIP_HEADER_BYTES =
  10;

const GZIP_ID_ONE =
  0x1f;

const GZIP_ID_TWO =
  0x8b;

const GZIP_DEFLATE_METHOD =
  8;

const authenticPublicationBundles =
  new WeakSet<object>();

export const PACKAGE_PUBLICATION_VERSION =
  1 as const;

export const PACKAGE_PUBLICATION_KIND =
  "aurora-package-publication-bundle" as const;

export const PACKAGE_PUBLICATION_MAX_INPUT_BYTES =
  128 * 1024 * 1024;

export interface PackagePublicationReceipt {
  readonly publicationVersion:
    typeof PACKAGE_PUBLICATION_VERSION;
  readonly kind:
    typeof PACKAGE_PUBLICATION_KIND;
  readonly packageId: string;
  readonly version: string;
  readonly publisherId: string;
  readonly manifestDigest: string;
  readonly artifactDigest: string;
  readonly signature:
    | {
        readonly algorithm:
          "ed25519";
        readonly keyId: string;
      }
    | null;
  readonly archive: {
    readonly algorithm:
      "sha256";
    readonly format:
      "tar+gzip";
    readonly digest: string;
    readonly size: number;
    readonly fileName:
      typeof ARCHIVE_FILE_NAME;
  };
  readonly provenance: {
    readonly type:
      "source" |
      "build";
    readonly url: string;
    readonly reference: string;
  };
}

export interface VerifiedPackagePublicationBundle {
  readonly source:
    "verified-package-publication";
  readonly packageRoot: string;
  readonly receipt:
    PackagePublicationReceipt;
  readonly archiveBytes:
    () => Buffer;
  readonly receiptBytes:
    () => Buffer;
}

export interface VerifiedPackagePublicationBuilderOptions {
  readonly trust?:
    PackageTrustPolicyOptions;
  readonly maxInputBytes?: number;
}

export interface PublishedPackageBundle {
  readonly receipt:
    PackagePublicationReceipt;
  readonly bundlePath: string;
  readonly archivePath: string;
  readonly receiptPath: string;
}

export interface PackagePublicationWriterOptions {
  readonly workspaceRoot: string;
  readonly publicationDirectory?: string;
}

interface ArchiveEntry {
  readonly path: string;
  readonly content: Buffer;
}

interface TarPath {
  readonly name: string;
  readonly prefix: string;
}

function publicationFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Package '${packageId}' publication bundle failed: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_PUBLICATION_FAILED,
      suggestion:
        "Use an authentic signed manifest, an exact declared file inventory, and a private local publication directory.",
      cause,
    }
  );
}

function sha256(
  value:
    Uint8Array
): string {
  return createHash(
    "sha256"
  )
    .update(value)
    .digest("hex");
}

function deepFreeze<T>(
  value: T
): T {
  if (
    typeof value !==
      "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child
    of Object.values(value)
  ) {
    deepFreeze(child);
  }

  return Object.freeze(value);
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

function fileChanged(
  before: Stats,
  after: Stats
): boolean {
  return (
    before.size !== after.size ||
    before.mtimeMs !==
      after.mtimeMs ||
    before.ctimeMs !==
      after.ctimeMs
  );
}

async function readVerifiedFile(
  boundary: ProjectPathBoundary,
  relativePath: string,
  expectedDigest: string,
  packageId: string,
  maxBytes: number
): Promise<Buffer> {
  const file =
    boundary.resolve(
      relativePath
    );

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
      await fs.lstat(file);

    if (
      pathBefore.isSymbolicLink() ||
      !pathBefore.isFile() ||
      !before.isFile() ||
      !sameFileIdentity(
        before,
        pathBefore
      )
    ) {
      throw new Error(
        `Publication input '${relativePath}' is not the same regular file that was opened.`
      );
    }

    if (
      before.size >
        maxBytes
    ) {
      throw new Error(
        `Publication input '${relativePath}' exceeds the remaining byte limit.`
      );
    }

    const content =
      await handle.readFile();

    const after =
      await handle.stat();

    const pathAfter =
      await fs.lstat(file);

    if (
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      !sameFileIdentity(
        before,
        after
      ) ||
      !sameFileIdentity(
        after,
        pathAfter
      ) ||
      fileChanged(
        before,
        after
      )
    ) {
      throw new Error(
        `Publication input '${relativePath}' changed while it was being read.`
      );
    }

    if (
      sha256(content) !==
        expectedDigest
    ) {
      throw new Error(
        `Publication input '${relativePath}' does not match its authenticated SHA-256 digest.`
      );
    }

    return content;
  }
  catch (error) {
    if (
      error instanceof AuroraError &&
      error.code ===
        ErrorCodes
          .PACKAGE_PUBLICATION_FAILED
    ) {
      throw error;
    }

    throw publicationFailure(
      packageId,
      `input '${relativePath}' could not be read safely.`,
      error
    );
  }
  finally {
    await handle?.close();
  }
}

function splitTarPath(
  value: string,
  packageId: string
): TarPath {
  if (
    Buffer.byteLength(
      value,
      "ascii"
    ) !== value.length
  ) {
    throw publicationFailure(
      packageId,
      `archive path '${value}' is not printable ASCII.`
    );
  }

  if (
    value.length <=
      TAR_NAME_BYTES
  ) {
    return {
      name: value,
      prefix: "",
    };
  }

  for (
    let index =
      value.lastIndexOf("/");
    index > 0;
    index =
      value.lastIndexOf(
        "/",
        index - 1
      )
  ) {
    const prefix =
      value.slice(
        0,
        index
      );

    const name =
      value.slice(
        index + 1
      );

    if (
      prefix.length <=
        TAR_PREFIX_BYTES &&
      name.length <=
        TAR_NAME_BYTES
    ) {
      return {
        name,
        prefix,
      };
    }
  }

  throw publicationFailure(
    packageId,
    `archive path '${value}' cannot be represented by canonical POSIX ustar.`
  );
}

function writeTarOctal(
  block: Buffer,
  offset: number,
  length: number,
  value: number,
  packageId: string
): void {
  const digits =
    value.toString(8);

  if (
    digits.length >
      length - 1
  ) {
    throw publicationFailure(
      packageId,
      "archive metadata exceeds canonical POSIX ustar limits."
    );
  }

  Buffer.from(
    digits.padStart(
      length - 1,
      "0"
    ),
    "ascii"
  ).copy(
    block,
    offset
  );

  block[
    offset +
      length - 1
  ] = 0;
}

function createTarHeader(
  entry: ArchiveEntry,
  packageId: string
): Buffer {
  const path =
    splitTarPath(
      entry.path,
      packageId
    );

  const block =
    Buffer.alloc(
      TAR_BLOCK_BYTES
    );

  Buffer.from(
    path.name,
    "ascii"
  ).copy(block, 0);

  writeTarOctal(
    block,
    100,
    8,
    0o600,
    packageId
  );

  writeTarOctal(
    block,
    108,
    8,
    0,
    packageId
  );

  writeTarOctal(
    block,
    116,
    8,
    0,
    packageId
  );

  writeTarOctal(
    block,
    124,
    12,
    entry.content.byteLength,
    packageId
  );

  writeTarOctal(
    block,
    136,
    12,
    0,
    packageId
  );

  block.fill(
    0x20,
    148,
    156
  );

  block[156] =
    "0".charCodeAt(0);

  Buffer.from(
    "ustar\0",
    "ascii"
  ).copy(block, 257);

  Buffer.from(
    "00",
    "ascii"
  ).copy(block, 263);

  Buffer.from(
    path.prefix,
    "ascii"
  ).copy(block, 345);

  let checksum = 0;

  for (const byte of block) {
    checksum += byte;
  }

  const checksumDigits =
    checksum.toString(8);

  if (
    checksumDigits.length > 6
  ) {
    throw publicationFailure(
      packageId,
      "archive header checksum exceeds canonical POSIX ustar limits."
    );
  }

  Buffer.from(
    checksumDigits.padStart(
      6,
      "0"
    ),
    "ascii"
  ).copy(block, 148);

  block[154] = 0;
  block[155] = 0x20;

  return block;
}

function createTarArchive(
  entries:
    readonly ArchiveEntry[],
  packageId: string
): Buffer {
  const parts:
    Buffer[] = [];

  for (const entry of entries) {
    parts.push(
      createTarHeader(
        entry,
        packageId
      ),
      entry.content
    );

    const padding =
      (
        TAR_BLOCK_BYTES -
        (
          entry.content.byteLength %
          TAR_BLOCK_BYTES
        )
      ) %
      TAR_BLOCK_BYTES;

    if (padding > 0) {
      parts.push(
        Buffer.alloc(padding)
      );
    }
  }

  parts.push(
    Buffer.alloc(
      TAR_BLOCK_BYTES * 2
    )
  );

  return Buffer.concat(parts);
}

function createCanonicalGzip(
  tar: Buffer,
  packageId: string
): Buffer {
  const archive =
    gzipSync(
      tar,
      {
        level: 9,
      }
    );

  if (
    archive.byteLength <
      GZIP_HEADER_BYTES ||
    archive[0] !==
      GZIP_ID_ONE ||
    archive[1] !==
      GZIP_ID_TWO ||
    archive[2] !==
      GZIP_DEFLATE_METHOD ||
    archive[3] !== 0
  ) {
    throw publicationFailure(
      packageId,
      "the runtime did not produce the expected canonical gzip envelope."
    );
  }

  archive.fill(
    0,
    4,
    8
  );

  /*
   * Normalize the gzip operating-system marker so Windows,
   * Linux, and macOS builds use the same envelope bytes.
   */
  archive[9] = 0xff;

  return archive;
}

function createReceipt(
  manifest: PackageManifest,
  manifestDigest: string,
  archive: Buffer
): PackagePublicationReceipt {
  return deepFreeze({
    publicationVersion:
      PACKAGE_PUBLICATION_VERSION,
    kind:
      PACKAGE_PUBLICATION_KIND,
    packageId:
      manifest.id,
    version:
      manifest.version,
    publisherId:
      manifest.publisher.id,
    manifestDigest,
    artifactDigest:
      manifest.artifact.digest,
    signature:
      manifest.signature ===
        undefined
        ? null
        : {
            algorithm:
              manifest.signature
                .algorithm,
            keyId:
              manifest.signature
                .keyId,
          },
    archive: {
      algorithm:
        "sha256",
      format:
        "tar+gzip",
      digest:
        sha256(archive),
      size:
        archive.byteLength,
      fileName:
        ARCHIVE_FILE_NAME,
    },
    provenance: {
      type:
        manifest.provenance
          .type,
      url:
        manifest.provenance
          .url,
      reference:
        manifest.provenance
          .reference,
    },
  });
}

function createBundle(
  packageRoot: string,
  receipt:
    PackagePublicationReceipt,
  archive: Buffer,
  receiptDocument: Buffer
): VerifiedPackagePublicationBundle {
  const bundle =
    Object.freeze({
      source:
        "verified-package-publication" as const,
      packageRoot,
      receipt,
      archiveBytes:
        () => Buffer.from(
          archive
        ),
      receiptBytes:
        () => Buffer.from(
          receiptDocument
        ),
    });

  authenticPublicationBundles
    .add(bundle);

  return bundle;
}

export function assertVerifiedPackagePublicationBundle(
  value: unknown
): asserts value is VerifiedPackagePublicationBundle {
  if (
    typeof value !==
      "object" ||
    value === null ||
    !authenticPublicationBundles
      .has(value)
  ) {
    throw new TypeError(
      "Expected an authentic verified package publication bundle."
    );
  }
}

export class VerifiedPackagePublicationBuilder {
  private readonly trustPolicy:
    PackageTrustPolicy;

  private readonly maxInputBytes:
    number;

  constructor(
    options:
      VerifiedPackagePublicationBuilderOptions = {}
  ) {
    this.trustPolicy =
      new PackageTrustPolicy(
        options.trust
      );

    this.maxInputBytes =
      options.maxInputBytes ??
      PACKAGE_PUBLICATION_MAX_INPUT_BYTES;

    if (
      !Number.isSafeInteger(
        this.maxInputBytes
      ) ||
      this.maxInputBytes <= 0 ||
      this.maxInputBytes >
        PACKAGE_PUBLICATION_MAX_INPUT_BYTES
    ) {
      throw new TypeError(
        "Package publication maxInputBytes must be a positive safe integer within Aurora's publication limit."
      );
    }

    Object.freeze(this);
  }

  async build(
    packagePath: string
  ): Promise<
    VerifiedPackagePublicationBundle
  > {
    const boundary =
      new ProjectPathBoundary(
        packagePath
      );

    const manifestPath =
      boundary.resolve(
        "manifest.json"
      );

    const document =
      await loadManifestDocument(
        manifestPath
      );

    const manifest =
      document.manifest;

    if (
      basename(
        boundary.projectRoot
      ) !== manifest.id
    ) {
      throw publicationFailure(
        manifest.id,
        "the canonical package directory name does not match the manifest package id."
      );
    }

    if (
      manifest.lifecycle
        .revoked
    ) {
      throw new AuroraError(
        `Package '${manifest.id}' is revoked and cannot be prepared for publication.`,
        {
          code:
            ErrorCodes
              .PACKAGE_REVOKED,
          suggestion:
            "Publish a non-revoked replacement package with a new authenticated version.",
        }
      );
    }

    this.trustPolicy.verify(
      manifest
    );

    await new PackageArtifactVerifier()
      .verify(
        dirname(
          boundary.projectRoot
        ),
        manifest
      );

    let remaining =
      this.maxInputBytes;

    const manifestBytes =
      await readVerifiedFile(
        boundary,
        "manifest.json",
        document.sha256,
        manifest.id,
        remaining
      );

    remaining -=
      manifestBytes.byteLength;

    const entries:
      ArchiveEntry[] = [
        {
          path:
            "manifest.json",
          content:
            manifestBytes,
        },
      ];

    for (
      const file
      of [...manifest.files]
        .sort(
          (
            left,
            right
          ) =>
            left.path < right.path
              ? -1
              : left.path >
                  right.path
                ? 1
                : 0
        )
    ) {
      const content =
        await readVerifiedFile(
          boundary,
          file.path,
          file.digest,
          manifest.id,
          remaining
        );

      remaining -=
        content.byteLength;

      entries.push({
        path:
          file.path,
        content,
      });
    }

    const archive =
      createCanonicalGzip(
        createTarArchive(
          entries,
          manifest.id
        ),
        manifest.id
      );

    const receipt =
      createReceipt(
        manifest,
        document.sha256,
        archive
      );

    const receiptDocument =
      Buffer.from(
        `${canonicalizeJson(
          receipt
        )}\n`,
        "utf8"
      );

    return createBundle(
      boundary.projectRoot,
      receipt,
      archive,
      receiptDocument
    );
  }
}

async function readExistingBundleFile(
  boundary: ProjectPathBoundary,
  relativePath: string,
  packageId: string,
  expectedDigest: string,
  maxBytes: number
): Promise<Buffer> {
  return readVerifiedFile(
    boundary,
    relativePath,
    expectedDigest,
    packageId,
    maxBytes
  );
}

async function verifyExistingBundle(
  finalPath: string,
  packageId: string,
  archive: Buffer,
  receipt: Buffer
): Promise<void> {
  const information =
    await fs.lstat(
      finalPath
    );

  if (
    information.isSymbolicLink() ||
    !information.isDirectory()
  ) {
    throw publicationFailure(
      packageId,
      "the content-addressed publication target already exists but is not a safe directory."
    );
  }

  const boundary =
    new ProjectPathBoundary(
      finalPath
    );

  const entries =
    (
      await fs.readdir(
        boundary.projectRoot
      )
    ).sort();

  if (
    entries.length !== 2 ||
    entries[0] !==
      ARCHIVE_FILE_NAME ||
    entries[1] !==
      RECEIPT_FILE_NAME
  ) {
    throw publicationFailure(
      packageId,
      "the content-addressed publication target contains unexpected files."
    );
  }

  let existingArchive: Buffer;
  let existingReceipt: Buffer;

  try {
    [
      existingArchive,
      existingReceipt,
    ] =
      await Promise.all([
        readExistingBundleFile(
          boundary,
          ARCHIVE_FILE_NAME,
          packageId,
          sha256(archive),
          archive.byteLength
        ),
        readExistingBundleFile(
          boundary,
          RECEIPT_FILE_NAME,
          packageId,
          sha256(receipt),
          receipt.byteLength
        ),
      ]);
  }
  catch (error) {
    throw publicationFailure(
      packageId,
      "the content-addressed publication target does not match the verified bundle bytes.",
      error
    );
  }

  if (
    !existingArchive.equals(
      archive
    ) ||
    !existingReceipt.equals(
      receipt
    )
  ) {
    throw publicationFailure(
      packageId,
      "the content-addressed publication target does not match the verified bundle bytes."
    );
  }
}

function isMissing(
  error: unknown
): boolean {
  return (
    typeof error ===
      "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export class PackagePublicationWriter {
  private readonly workspaceBoundary:
    ProjectPathBoundary;

  private readonly publicationDirectory:
    string;

  constructor(
    options:
      PackagePublicationWriterOptions
  ) {
    this.workspaceBoundary =
      new ProjectPathBoundary(
        options.workspaceRoot
      );

    this.publicationDirectory =
      options.publicationDirectory ??
      ".aurora/publications";

    Object.freeze(this);
  }

  async write(
    value: unknown
  ): Promise<
    PublishedPackageBundle
  > {
    assertVerifiedPackagePublicationBundle(
      value
    );

    const packagePath =
      this.workspaceBoundary
        .validateAbsolutePath(
          value.packageRoot
        );

    if (
      packagePath !==
        value.packageRoot
    ) {
      throw publicationFailure(
        value.receipt.packageId,
        "the verified package is outside the publication workspace."
      );
    }

    const publicationRoot =
      this.workspaceBoundary
        .resolve(
          this.publicationDirectory
        );

    await durableEnsureDirectory(
      publicationRoot
    );

    const publicationBoundary =
      new ProjectPathBoundary(
        publicationRoot
      );

    const archive =
      value.archiveBytes();

    const receipt =
      value.receiptBytes();

    if (
      sha256(archive) !==
        value.receipt.archive
          .digest ||
      archive.byteLength !==
        value.receipt.archive
          .size
    ) {
      throw publicationFailure(
        value.receipt.packageId,
        "the authentic in-memory archive no longer matches its content-addressed receipt."
      );
    }

    const relativeFinal =
      `${value.receipt.packageId}/${value.receipt.version}/${value.receipt.archive.digest}`;

    const finalPath =
      publicationBoundary
        .resolve(
          relativeFinal
        );

    try {
      await verifyExistingBundle(
        finalPath,
        value.receipt.packageId,
        archive,
        receipt
      );

      return this.createResult(
        value.receipt,
        finalPath
      );
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
      publicationBoundary
        .resolve(
          `.publication-${process.pid}-${randomUUID()}.tmp`
        );

    let stagingCreated =
      false;

    try {
      await durableCreateDirectory(
        stagingPath
      );

      stagingCreated = true;

      await durableWriteFile(
        join(
          stagingPath,
          ARCHIVE_FILE_NAME
        ),
        archive
      );

      await durableWriteFile(
        join(
          stagingPath,
          RECEIPT_FILE_NAME
        ),
        receipt
      );

      try {
        await fs.rename(
          stagingPath,
          finalPath
        );

        stagingCreated = false;

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

        await verifyExistingBundle(
          finalPath,
          value.receipt.packageId,
          archive,
          receipt
        );
      }

      return this.createResult(
        value.receipt,
        finalPath
      );
    }
    catch (error) {
      if (
        error instanceof AuroraError &&
        error.code ===
          ErrorCodes
            .PACKAGE_PUBLICATION_FAILED
      ) {
        throw error;
      }

      throw publicationFailure(
        value.receipt.packageId,
        "the verified bundle could not be committed atomically.",
        error
      );
    }
    finally {
      if (stagingCreated) {
        try {
          const validated =
            publicationBoundary
              .validateAbsolutePath(
                stagingPath
              );

          await fs.rm(
            validated,
            {
              recursive: true,
              force: true,
            }
          );
        }
        catch {
          // Preserve the primary publication failure.
        }
      }
    }
  }

  private createResult(
    receipt:
      PackagePublicationReceipt,
    bundlePath: string
  ): PublishedPackageBundle {
    return Object.freeze({
      receipt,
      bundlePath,
      archivePath:
        join(
          bundlePath,
          ARCHIVE_FILE_NAME
        ),
      receiptPath:
        join(
          bundlePath,
          RECEIPT_FILE_NAME
        ),
    });
  }
}
