import {
  createHash,
} from "node:crypto";

import {
  constants as fsConstants,
} from "node:fs";

import fs from "node:fs/promises";

import {
  dirname,
  join,
} from "node:path";

import {
  Transform,
  Writable,
  type TransformCallback,
} from "node:stream";

import {
  pipeline,
} from "node:stream/promises";

import {
  createGunzip,
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
  redactText,
} from "../../security/secretRedactor.js";

import {
  PackageArtifactVerifier,
} from "../integrity/packageArtifactVerifier.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  validatePackage,
} from "../packageValidator.js";

import {
  syncDirectory,
} from "../lifecycle/durableFileWriter.js";

import {
  PACKAGE_MANIFEST_MAX_BYTES,
  parsePackageManifestBytes,
} from "../trust/packageManifestJson.js";

import type {
  OfficialRegistryCatalogOptions,
} from "./officialRegistryCatalog.js";

import {
  assertCachedOfficialRegistryArtifact,
} from "./officialRegistryArtifactCache.js";

import type {
  CachedOfficialRegistryArtifact,
} from "./officialRegistryArtifactCache.js";

import {
  OfficialRegistryResolver,
} from "./officialRegistryResolver.js";

import type {
  ResolvedOfficialRegistryPackage,
} from "./officialRegistryResolver.js";

import type {
  OfficialRegistryPackageEntry,
} from "./officialRegistrySchema.js";

const TAR_BLOCK_BYTES =
  512;

const TAR_CHECKSUM_OFFSET =
  148;

const TAR_CHECKSUM_BYTES =
  8;

const TAR_NAME_BYTES =
  100;

const TAR_PREFIX_OFFSET =
  345;

const TAR_PREFIX_BYTES =
  155;

const TAR_SIZE_OFFSET =
  124;

const TAR_SIZE_BYTES =
  12;

const TAR_TYPE_OFFSET =
  156;

const TAR_MAGIC_OFFSET =
  257;

const TAR_VERSION_OFFSET =
  263;

const TAR_TRAILER_BLOCKS =
  2;

const TAR_HEADER_ALLOWANCE_BYTES =
  1024 * 1024;

const ARCHIVE_READ_BUFFER_BYTES =
  64 * 1024;

const WINDOWS_RESERVED_NAME =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

const extractedArtifacts =
  new WeakSet<object>();

export const OFFICIAL_REGISTRY_EXTRACTION_MAX_BYTES =
  512 * 1024 * 1024;

export const OFFICIAL_REGISTRY_EXTRACTION_MAX_ENTRIES =
  10_000;

export interface OfficialRegistryArtifactExtractorOptions {
  readonly registryOptions?:
    OfficialRegistryCatalogOptions;
  readonly maxExtractedBytes?: number;
  readonly maxEntries?: number;
}

export interface ExtractedOfficialRegistryArtifact {
  readonly source:
    "verified-extraction";
  readonly resolved:
    ResolvedOfficialRegistryPackage;
  readonly stagingPath: string;
  readonly packagePath: string;
  readonly manifestPath: string;
  readonly manifest:
    PackageManifest;
  readonly extractedFiles: number;
  readonly extractedBytes: number;
}

interface CurrentTarFile {
  readonly relativePath: string;
  readonly handle:
    fs.FileHandle;
  readonly isManifest: boolean;
  readonly manifestChunks:
    Buffer[];
  remaining: number;
  padding: number;
}

interface RegisteredTarPath {
  readonly path: string;
  readonly kind:
    "directory" |
    "file";
  explicit: boolean;
}

class ArchiveFormatError
extends Error {
  constructor(message: string) {
    super(message);
    this.name =
      "ArchiveFormatError";
  }
}

function extractionFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}' artifact extraction failed: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_EXTRACTION_FAILED,
      suggestion:
        "Use a private local staging directory and retry from an authenticated cache entry.",
      cause,
    }
  );
}

function extractionIntegrityFailure(
  packageId: string,
  message: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `Official package '${packageId}' extracted artifact failed verification: ${message}`,
    {
      code:
        ErrorCodes
          .PACKAGE_INTEGRITY_FAILED,
      suggestion:
        "Reject the staging directory and reacquire the package from the signed official registry.",
      cause,
    }
  );
}

function isErrno(
  error: unknown,
  code: string
): boolean {
  return (
    typeof error ===
      "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function toError(
  error: unknown
): Error {
  return error instanceof Error
    ? error
    : new Error(
        String(error)
      );
}

function freezeJson<T>(
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
    freezeJson(child);
  }

  return Object.freeze(value);
}

function assertSameEntryIdentity(
  expected:
    OfficialRegistryPackageEntry,
  received:
    OfficialRegistryPackageEntry
): void {
  if (
    expected.packageId !==
      received.packageId ||
    expected.version !==
      received.version ||
    expected.manifestDigest !==
      received.manifestDigest ||
    expected.archive.algorithm !==
      received.archive.algorithm ||
    expected.archive.digest !==
      received.archive.digest ||
    expected.archive.size !==
      received.archive.size ||
    expected.archive.url !==
      received.archive.url ||
    expected.provenance.type !==
      received.provenance.type ||
    expected.provenance.url !==
      received.provenance.url ||
    expected.provenance.reference !==
      received.provenance.reference ||
    expected.lifecycle.status !==
      received.lifecycle.status ||
    expected.lifecycle.reason !==
      received.lifecycle.reason
  ) {
    throw extractionIntegrityFailure(
      expected.packageId,
      "the cached receipt does not match the extractor's authenticated registry identity."
    );
  }
}

function readTarString(
  field: Buffer,
  label: string
): string {
  const terminator =
    field.indexOf(0);

  const end =
    terminator === -1
      ? field.byteLength
      : terminator;

  for (
    let index = end;
    index < field.byteLength;
    index++
  ) {
    if (field[index] !== 0) {
      throw new ArchiveFormatError(
        `${label} contains non-canonical padding.`
      );
    }
  }

  const bytes =
    field.subarray(
      0,
      end
    );

  for (const byte of bytes) {
    if (
      byte < 0x20 ||
      byte > 0x7e
    ) {
      throw new ArchiveFormatError(
        `${label} must use printable ASCII.`
      );
    }
  }

  return bytes.toString(
    "ascii"
  );
}

function readTarOctal(
  field: Buffer,
  label: string
): number {
  if (
    field.byteLength === 0 ||
    (
      field[0] & 0x80
    ) !== 0
  ) {
    throw new ArchiveFormatError(
      `${label} must use bounded POSIX octal encoding.`
    );
  }

  let end =
    field.byteLength;

  while (
    end > 0 &&
    (
      field[end - 1] === 0 ||
      field[end - 1] === 0x20
    )
  ) {
    end--;
  }

  let start = 0;

  while (
    start < end &&
    field[start] === 0x20
  ) {
    start++;
  }

  if (start === end) {
    return 0;
  }

  const text =
    field.subarray(
      start,
      end
    ).toString(
      "ascii"
    );

  if (!/^[0-7]+$/u.test(text)) {
    throw new ArchiveFormatError(
      `${label} is not canonical POSIX octal.`
    );
  }

  const value =
    Number.parseInt(
      text,
      8
    );

  if (!Number.isSafeInteger(value)) {
    throw new ArchiveFormatError(
      `${label} exceeds Aurora's safe integer limit.`
    );
  }

  return value;
}

function assertTarChecksum(
  header: Buffer
): void {
  const expected =
    readTarOctal(
      header.subarray(
        TAR_CHECKSUM_OFFSET,
        TAR_CHECKSUM_OFFSET +
          TAR_CHECKSUM_BYTES
      ),
      "Tar header checksum"
    );

  let actual = 0;

  for (
    let index = 0;
    index < header.byteLength;
    index++
  ) {
    actual +=
      index >=
        TAR_CHECKSUM_OFFSET &&
      index <
        TAR_CHECKSUM_OFFSET +
          TAR_CHECKSUM_BYTES
        ? 0x20
        : header[index];
  }

  if (actual !== expected) {
    throw new ArchiveFormatError(
      "Tar header checksum verification failed."
    );
  }
}

function isZeroBlock(
  block: Buffer
): boolean {
  for (const byte of block) {
    if (byte !== 0) {
      return false;
    }
  }

  return true;
}

function assertUstarHeader(
  header: Buffer
): void {
  const magic =
    header.subarray(
      TAR_MAGIC_OFFSET,
      TAR_MAGIC_OFFSET + 6
    );

  const version =
    header.subarray(
      TAR_VERSION_OFFSET,
      TAR_VERSION_OFFSET + 2
    );

  if (
    !magic.equals(
      Buffer.from(
        "ustar\0",
        "ascii"
      )
    ) ||
    !version.equals(
      Buffer.from(
        "00",
        "ascii"
      )
    )
  ) {
    throw new ArchiveFormatError(
      "Archive entries must use the POSIX ustar format."
    );
  }
}

function canonicalArchivePath(
  header: Buffer,
  directory: boolean
): string {
  const name =
    readTarString(
      header.subarray(
        0,
        TAR_NAME_BYTES
      ),
      "Tar entry name"
    );

  const prefix =
    readTarString(
      header.subarray(
        TAR_PREFIX_OFFSET,
        TAR_PREFIX_OFFSET +
          TAR_PREFIX_BYTES
      ),
      "Tar entry prefix"
    );

  let candidate =
    prefix
      ? `${prefix}/${name}`
      : name;

  if (
    directory &&
    candidate.endsWith("/")
  ) {
    candidate =
      candidate.slice(
        0,
        -1
      );
  }

  if (
    !candidate ||
    candidate.length > 512 ||
    candidate.startsWith("/") ||
    candidate.endsWith("/") ||
    candidate.includes("\\") ||
    candidate.includes("\0")
  ) {
    throw new ArchiveFormatError(
      "Tar entry path is empty, absolute, oversized, or platform-ambiguous."
    );
  }

  const segments =
    candidate.split("/");

  if (
    segments.some(
      segment =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":") ||
        /[\u0000-\u001f]/u.test(
          segment
        ) ||
        /[. ]$/u.test(segment) ||
        WINDOWS_RESERVED_NAME.test(
          segment
        )
    )
  ) {
    throw new ArchiveFormatError(
      `Tar entry path '${candidate}' is not a canonical cross-platform relative path.`
    );
  }

  return candidate;
}

async function writeAll(
  handle: fs.FileHandle,
  buffer: Buffer
): Promise<void> {
  let offset = 0;

  while (offset < buffer.byteLength) {
    const result =
      await handle.write(
        buffer,
        offset,
        buffer.byteLength -
          offset,
        null
      );

    if (result.bytesWritten <= 0) {
      throw new Error(
        "Archive extraction write made no progress."
      );
    }

    offset +=
      result.bytesWritten;
  }
}

async function openRegularFile(
  file: string,
  packageId: string
): Promise<fs.FileHandle> {
  const handle =
    await fs.open(
      file,
      process.platform ===
        "win32"
        ? "r"
        : fsConstants.O_RDONLY |
          fsConstants.O_NOFOLLOW
    );

  try {
    const [
      openedInformation,
      pathInformation,
    ] =
      await Promise.all([
        handle.stat(),
        fs.lstat(file),
      ]);

    if (
      pathInformation.isSymbolicLink() ||
      !pathInformation.isFile() ||
      !openedInformation.isFile() ||
      pathInformation.dev !==
        openedInformation.dev ||
      pathInformation.ino !==
        openedInformation.ino
    ) {
      throw extractionIntegrityFailure(
        packageId,
        "the cached archive path is not the same regular file that was opened."
      );
    }

    return handle;
  }
  catch (error) {
    await handle.close();
    throw error;
  }
}

class ArchiveVerificationTransform
extends Transform {
  private readonly hash =
    createHash(
      "sha256"
    );

  private bytes = 0;

  constructor(
    private readonly packageId:
      string,
    private readonly expectedBytes:
      number,
    private readonly expectedDigest:
      string
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    try {
      this.bytes +=
        chunk.byteLength;

      if (
        this.bytes >
          this.expectedBytes
      ) {
        throw extractionIntegrityFailure(
          this.packageId,
          "the cached archive exceeds its signed byte size."
        );
      }

      this.hash.update(chunk);
      callback(
        null,
        chunk
      );
    }
    catch (error) {
      callback(
        toError(error)
      );
    }
  }

  override _flush(
    callback: TransformCallback
  ): void {
    try {
      if (
        this.bytes !==
          this.expectedBytes
      ) {
        throw extractionIntegrityFailure(
          this.packageId,
          "the cached archive byte count does not match its signed size."
        );
      }

      if (
        this.hash.digest("hex") !==
          this.expectedDigest
      ) {
        throw extractionIntegrityFailure(
          this.packageId,
          "the cached archive SHA-256 digest does not match the signed registry digest."
        );
      }

      callback();
    }
    catch (error) {
      callback(
        toError(error)
      );
    }
  }
}

class TarExtractionSink
extends Writable {
  private pending =
    Buffer.alloc(0);

  private current:
    CurrentTarFile |
    undefined;

  private trailerBlocks = 0;

  private entries = 0;

  private files = 0;

  private bytes = 0;

  private tarBytes = 0;

  private readonly registeredPaths =
    new Map<
      string,
      RegisteredTarPath
    >();

  private manifest:
    Buffer |
    undefined;

  constructor(
    private readonly packageId:
      string,
    private readonly boundary:
      ProjectPathBoundary,
    private readonly maxExtractedBytes:
      number,
    private readonly maxEntries:
      number
  ) {
    super();
  }

  get manifestBytes(): Buffer {
    if (this.manifest === undefined) {
      throw new ArchiveFormatError(
        "Archive does not contain a root manifest.json file."
      );
    }

    return Buffer.from(
      this.manifest
    );
  }

  get extractedFiles(): number {
    return this.files;
  }

  get extractedBytes(): number {
    return this.bytes;
  }

  async abort(): Promise<void> {
    try {
      await this.current
        ?.handle.close();
    }
    catch {
      // Preserve the primary extraction failure.
    }

    this.current =
      undefined;
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback:
      (
        error?:
          Error |
          null
      ) => void
  ): void {
    void this.consume(chunk)
      .then(
        () => callback(),
        error => callback(
          toError(error)
        )
      );
  }

  override _final(
    callback:
      (
        error?:
          Error |
          null
      ) => void
  ): void {
    void this.finish()
      .then(
        () => callback(),
        error => callback(
          toError(error)
        )
      );
  }

  private async consume(
    chunk: Buffer
  ): Promise<void> {
    this.tarBytes +=
      chunk.byteLength;

    const maximumTarBytes =
      this.maxExtractedBytes +
      this.maxEntries *
        TAR_BLOCK_BYTES * 2 +
      TAR_HEADER_ALLOWANCE_BYTES;

    if (
      this.tarBytes >
        maximumTarBytes
    ) {
      throw new ArchiveFormatError(
        "Expanded tar stream exceeds Aurora's bounded extraction policy."
      );
    }

    this.pending =
      this.pending.byteLength === 0
        ? Buffer.from(chunk)
        : Buffer.concat([
            this.pending,
            chunk,
          ]);

    while (true) {
      if (this.current) {
        if (
          this.current.remaining > 0
        ) {
          if (
            this.pending.byteLength === 0
          ) {
            return;
          }

          const length =
            Math.min(
              this.current.remaining,
              this.pending.byteLength
            );

          const content =
            this.pending.subarray(
              0,
              length
            );

          this.pending =
            this.pending.subarray(
              length
            );

          await writeAll(
            this.current.handle,
            content
          );

          if (
            this.current.isManifest
          ) {
            this.current
              .manifestChunks.push(
                Buffer.from(content)
              );
          }

          this.current.remaining -=
            length;

          if (
            this.current.remaining > 0
          ) {
            return;
          }

          await this.current
            .handle.sync();
          await this.current
            .handle.close();

          if (
            this.current.isManifest
          ) {
            this.manifest =
              Buffer.concat(
                this.current
                  .manifestChunks
              );
          }
        }

        if (
          this.pending.byteLength <
            this.current.padding
        ) {
          return;
        }

        const padding =
          this.pending.subarray(
            0,
            this.current.padding
          );

        if (!isZeroBlock(padding)) {
          throw new ArchiveFormatError(
            `Tar entry '${this.current.relativePath}' contains non-zero padding.`
          );
        }

        this.pending =
          this.pending.subarray(
            this.current.padding
          );
        this.current =
          undefined;
        continue;
      }

      if (
        this.pending.byteLength <
          TAR_BLOCK_BYTES
      ) {
        return;
      }

      const header =
        this.pending.subarray(
          0,
          TAR_BLOCK_BYTES
        );

      this.pending =
        this.pending.subarray(
          TAR_BLOCK_BYTES
        );

      if (isZeroBlock(header)) {
        this.trailerBlocks++;
        continue;
      }

      if (this.trailerBlocks > 0) {
        throw new ArchiveFormatError(
          "Tar archive contains data after its end marker."
        );
      }

      await this.consumeHeader(header);
    }
  }

  private async consumeHeader(
    header: Buffer
  ): Promise<void> {
    assertTarChecksum(header);
    assertUstarHeader(header);

    this.entries++;

    if (
      this.entries >
        this.maxEntries
    ) {
      throw new ArchiveFormatError(
        "Tar archive exceeds Aurora's entry-count limit."
      );
    }

    const type =
      header[TAR_TYPE_OFFSET];

    const regular =
      type === 0 ||
      type === 0x30;

    const directory =
      type === 0x35;

    if (
      !regular &&
      !directory
    ) {
      throw new ArchiveFormatError(
        "Tar archive contains a link, device, extension, or unsupported entry type."
      );
    }

    const relativePath =
      canonicalArchivePath(
        header,
        directory
      );

    const size =
      readTarOctal(
        header.subarray(
          TAR_SIZE_OFFSET,
          TAR_SIZE_OFFSET +
            TAR_SIZE_BYTES
        ),
        `Tar entry '${relativePath}' size`
      );

    if (
      directory &&
      size !== 0
    ) {
      throw new ArchiveFormatError(
        `Tar directory '${relativePath}' has a non-zero body.`
      );
    }

    this.registerPath(
      relativePath,
      directory
        ? "directory"
        : "file"
    );

    if (directory) {
      await this.ensureDirectory(
        relativePath
      );
      return;
    }

    if (
      this.bytes + size >
        this.maxExtractedBytes
    ) {
      throw new ArchiveFormatError(
        "Tar archive exceeds Aurora's extracted-byte limit."
      );
    }

    const isManifest =
      relativePath ===
        "manifest.json";

    if (
      isManifest &&
      size >
        PACKAGE_MANIFEST_MAX_BYTES
    ) {
      throw new ArchiveFormatError(
        "Archive manifest.json exceeds the Package Manifest v1 byte limit."
      );
    }

    await this.ensureDirectory(
      dirname(relativePath) === "."
        ? undefined
        : dirname(relativePath)
    );

    const target =
      this.boundary.resolve(
        relativePath
      );

    const handle =
      await fs.open(
        target,
        "wx",
        0o600
      );

    this.files++;
    this.bytes += size;

    this.current = {
      relativePath,
      handle,
      isManifest,
      manifestChunks: [],
      remaining: size,
      padding:
        (
          TAR_BLOCK_BYTES -
          (
            size %
            TAR_BLOCK_BYTES
          )
        ) %
        TAR_BLOCK_BYTES,
    };

    if (size === 0) {
      await handle.sync();
      await handle.close();

      if (isManifest) {
        this.manifest =
          Buffer.alloc(0);
      }
    }
  }

  private registerPath(
    relativePath: string,
    kind:
      "directory" |
      "file"
  ): void {
    const segments =
      relativePath.split("/");

    for (
      let index = 1;
      index < segments.length;
      index++
    ) {
      const parent =
        segments.slice(
          0,
          index
        ).join("/");

      this.registerImplicitDirectory(
        parent
      );
    }

    const key =
      relativePath.toLowerCase();

    const existing =
      this.registeredPaths.get(key);

    if (existing) {
      if (
        existing.path !==
          relativePath ||
        existing.kind !== kind ||
        existing.explicit
      ) {
        throw new ArchiveFormatError(
          `Tar entry '${relativePath}' duplicates or conflicts with '${existing.path}'.`
        );
      }

      existing.explicit =
        true;
      return;
    }

    this.registeredPaths.set(
      key,
      {
        path:
          relativePath,
        kind,
        explicit:
          true,
      }
    );
  }

  private registerImplicitDirectory(
    relativePath: string
  ): void {
    const key =
      relativePath.toLowerCase();

    const existing =
      this.registeredPaths.get(key);

    if (existing) {
      if (
        existing.path !==
          relativePath ||
        existing.kind !==
          "directory"
      ) {
        throw new ArchiveFormatError(
          `Tar path '${relativePath}' conflicts with '${existing.path}'.`
        );
      }

      return;
    }

    this.registeredPaths.set(
      key,
      {
        path:
          relativePath,
        kind:
          "directory",
        explicit:
          false,
      }
    );
  }

  private async ensureDirectory(
    relativePath?: string
  ): Promise<void> {
    if (!relativePath) {
      return;
    }

    const segments =
      relativePath.split("/");

    for (
      let index = 1;
      index <= segments.length;
      index++
    ) {
      const current =
        this.boundary.resolve(
          segments.slice(
            0,
            index
          ).join("/")
        );

      try {
        await fs.mkdir(
          current,
          {
            mode:
              0o700,
          }
        );
      }
      catch (error) {
        if (!isErrno(error, "EEXIST")) {
          throw error;
        }

        const information =
          await fs.lstat(current);

        if (
          information.isSymbolicLink() ||
          !information.isDirectory()
        ) {
          throw new ArchiveFormatError(
            `Tar directory '${segments.slice(0, index).join("/")}' is unsafe.`
          );
        }
      }
    }
  }

  private async finish():
    Promise<void> {
    if (this.current) {
      throw new ArchiveFormatError(
        `Tar entry '${this.current.relativePath}' is truncated.`
      );
    }

    if (
      this.pending.byteLength !== 0
    ) {
      throw new ArchiveFormatError(
        "Tar archive ends with a partial block."
      );
    }

    if (
      this.trailerBlocks <
        TAR_TRAILER_BLOCKS
    ) {
      throw new ArchiveFormatError(
        "Tar archive is missing its two-block end marker."
      );
    }

    if (this.manifest === undefined) {
      throw new ArchiveFormatError(
        "Archive does not contain a root manifest.json file."
      );
    }
  }
}

function createExtractedReceipt(
  resolved:
    ResolvedOfficialRegistryPackage,
  stagingPath: string,
  packagePath: string,
  manifestPath: string,
  manifest:
    PackageManifest,
  extractedFiles: number,
  extractedBytes: number
): ExtractedOfficialRegistryArtifact {
  const receipt:
    ExtractedOfficialRegistryArtifact =
      Object.freeze({
        source:
          "verified-extraction",
        resolved,
        stagingPath,
        packagePath,
        manifestPath,
        manifest:
          freezeJson(manifest),
        extractedFiles,
        extractedBytes,
      });

  extractedArtifacts.add(
    receipt
  );

  return receipt;
}

export function assertExtractedOfficialRegistryArtifact(
  value: unknown
): asserts value is
  ExtractedOfficialRegistryArtifact {
  if (
    typeof value !==
      "object" ||
    value === null ||
    !extractedArtifacts.has(value)
  ) {
    throw new TypeError(
      "Expected an authentic extracted official registry artifact receipt."
    );
  }
}

export class OfficialRegistryArtifactExtractor {
  private readonly registryResolver:
    OfficialRegistryResolver;

  private readonly extractionBoundary:
    ProjectPathBoundary;

  private readonly maxExtractedBytes:
    number;

  private readonly maxEntries:
    number;

  constructor(
    value: unknown,
    extractionRoot: string,
    options:
      OfficialRegistryArtifactExtractorOptions = {}
  ) {
    this.registryResolver =
      new OfficialRegistryResolver(
        value,
        options.registryOptions
      );

    this.extractionBoundary =
      new ProjectPathBoundary(
        extractionRoot
      );

    this.maxExtractedBytes =
      options.maxExtractedBytes ??
      OFFICIAL_REGISTRY_EXTRACTION_MAX_BYTES;

    this.maxEntries =
      options.maxEntries ??
      OFFICIAL_REGISTRY_EXTRACTION_MAX_ENTRIES;

    if (
      !Number.isSafeInteger(
        this.maxExtractedBytes
      ) ||
      this.maxExtractedBytes <= 0 ||
      this.maxExtractedBytes >
        OFFICIAL_REGISTRY_EXTRACTION_MAX_BYTES
    ) {
      throw new TypeError(
        "Official registry extraction maxExtractedBytes must be a positive safe integer within Aurora's absolute extraction limit."
      );
    }

    if (
      !Number.isSafeInteger(
        this.maxEntries
      ) ||
      this.maxEntries <= 0 ||
      this.maxEntries >
        OFFICIAL_REGISTRY_EXTRACTION_MAX_ENTRIES
    ) {
      throw new TypeError(
        "Official registry extraction maxEntries must be a positive safe integer within Aurora's absolute entry limit."
      );
    }

    Object.freeze(this);
  }

  async extract(
    cached:
      CachedOfficialRegistryArtifact
  ):
    Promise<
      ExtractedOfficialRegistryArtifact
    > {
    assertCachedOfficialRegistryArtifact(
      cached
    );

    const packageId =
      cached.resolved
        .entry.packageId;

    let resolved:
      ResolvedOfficialRegistryPackage;

    try {
      resolved =
        this.registryResolver
          .resolve(
            packageId,
            {
              kind:
                "exact",
              version:
                cached.resolved
                  .entry.version,
            }
          );
    }
    catch (error) {
      throw extractionIntegrityFailure(
        packageId,
        "the current signed registry no longer authorizes the cached package version.",
        error
      );
    }

    assertSameEntryIdentity(
      resolved.entry,
      cached.resolved.entry
    );

    await this.assertExtractionRootSafe(
      packageId
    );

    let stagingPath:
      string |
      undefined;

    let sink:
      TarExtractionSink |
      undefined;

    let archiveHandle:
      fs.FileHandle |
      undefined;

    try {
      stagingPath =
        await fs.mkdtemp(
          join(
            this.extractionBoundary
              .projectRoot,
            ".aurora-extract-"
          ),
          {
            encoding:
              "utf8",
          }
        );

      stagingPath =
        this.extractionBoundary
          .validateAbsolutePath(
            stagingPath
          );

      const packagePath =
        join(
          stagingPath,
          packageId
        );

      await fs.mkdir(
        packagePath,
        {
          mode:
            0o700,
        }
      );

      const packageBoundary =
        new ProjectPathBoundary(
          packagePath
        );

      archiveHandle =
        await openRegularFile(
          cached.filePath,
          packageId
        );

      sink =
        new TarExtractionSink(
          packageId,
          packageBoundary,
          this.maxExtractedBytes,
          this.maxEntries
        );

      const source =
        archiveHandle
          .createReadStream({
            autoClose:
              false,
            start:
              0,
            highWaterMark:
              ARCHIVE_READ_BUFFER_BYTES,
          });

      await pipeline(
        source,
        new ArchiveVerificationTransform(
          packageId,
          resolved.entry
            .archive.size,
          resolved.entry
            .archive.digest
        ),
        createGunzip(),
        sink
      );

      const [
        pathInformation,
        openedInformation,
      ] =
        await Promise.all([
          fs.lstat(
            cached.filePath
          ),
          archiveHandle.stat(),
        ]);

      if (
        pathInformation.isSymbolicLink() ||
        !pathInformation.isFile() ||
        pathInformation.dev !==
          openedInformation.dev ||
        pathInformation.ino !==
          openedInformation.ino
      ) {
        throw extractionIntegrityFailure(
          packageId,
          "the cached archive path changed during extraction."
        );
      }

      const manifestBytes =
        sink.manifestBytes;

      const manifestDigest =
        createHash(
          "sha256"
        ).update(
          manifestBytes
        ).digest(
          "hex"
        );

      if (
        manifestDigest !==
          resolved.entry
            .manifestDigest
      ) {
        throw extractionIntegrityFailure(
          packageId,
          "manifest.json does not match the digest authenticated by the official registry."
        );
      }

      let manifest:
        PackageManifest;

      try {
        manifest =
          validatePackage(
            parsePackageManifestBytes(
              manifestBytes
            ),
            "authenticated official registry archive manifest.json"
          );
      }
      catch (error) {
        throw extractionIntegrityFailure(
          packageId,
          "manifest.json is not a valid unambiguous Package Manifest v1 document.",
          error
        );
      }

      if (
        manifest.id !==
          resolved.entry.packageId ||
        manifest.version !==
          resolved.entry.version
      ) {
        throw extractionIntegrityFailure(
          packageId,
          "manifest.json package identity does not match the signed registry entry."
        );
      }

      await new PackageArtifactVerifier()
        .verify(
          stagingPath,
          manifest
        );

      await syncDirectory(
        packageBoundary.projectRoot
      );
      await syncDirectory(
        stagingPath
      );

      return createExtractedReceipt(
        resolved,
        stagingPath,
        packageBoundary.projectRoot,
        packageBoundary.resolve(
          "manifest.json"
        ),
        manifest,
        sink.extractedFiles,
        sink.extractedBytes
      );
    }
    catch (error) {
      await sink?.abort();

      if (stagingPath) {
        try {
          const validated =
            this.extractionBoundary
              .validateAbsolutePath(
                stagingPath
              );

          await fs.rm(
            validated,
            {
              recursive:
                true,
              force:
                true,
            }
          );
        }
        catch {
          // Preserve the primary extraction failure.
        }
      }

      if (
        error instanceof AuroraError &&
        error.code ===
          ErrorCodes
            .PACKAGE_INTEGRITY_FAILED
      ) {
        throw error;
      }

      throw extractionIntegrityFailure(
        packageId,
        redactText(
          error instanceof Error
            ? error.message
            : String(error)
        ),
        error
      );
    }
    finally {
      await archiveHandle
        ?.close();
    }
  }

  private async assertExtractionRootSafe(
    packageId: string
  ): Promise<void> {
    try {
      const information =
        await fs.lstat(
          this.extractionBoundary
            .projectRoot
        );

      if (
        information.isSymbolicLink() ||
        !information.isDirectory()
      ) {
        throw new Error(
          "Artifact extraction root is not a regular directory."
        );
      }
    }
    catch (error) {
      throw extractionFailure(
        packageId,
        "the private extraction root is unsafe or unavailable.",
        error
      );
    }
  }
}
