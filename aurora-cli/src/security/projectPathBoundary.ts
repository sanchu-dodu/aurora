import fs from "node:fs";
import path from "node:path";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

const PATH_SUGGESTION =
  "Use a relative path that stays inside the project and does not pass through a symbolic link or junction.";

export class ProjectPathBoundary {
  private readonly canonicalRoot:
    string;

  constructor(projectPath: string) {
    if (
      !projectPath.trim() ||
      projectPath.includes("\0")
    ) {
      throw unsafePath(
        projectPath,
        "Project root is empty or invalid."
      );
    }

    const resolvedRoot =
      path.resolve(projectPath);

    try {
      const information =
        fs.statSync(resolvedRoot);

      if (!information.isDirectory()) {
        throw unsafePath(
          projectPath,
          "Project root is not a directory."
        );
      }

      this.canonicalRoot =
        fs.realpathSync.native(
          resolvedRoot
        );
    } catch (error) {
      if (error instanceof AuroraError) {
        throw error;
      }

      throw unsafePath(
        projectPath,
        "Project root cannot be safely resolved.",
        error
      );
    }
  }

  get projectRoot(): string {
    return this.canonicalRoot;
  }

  resolve(relativePath: string): string {
    const segments =
      validateRelativePath(
        relativePath
      );

    const candidate =
      path.resolve(
        this.canonicalRoot,
        ...segments
      );

    assertInsideRoot(
      this.canonicalRoot,
      candidate,
      relativePath
    );

    this.assertSafeAncestors(
      segments,
      relativePath
    );

    return candidate;
  }

  validateAbsolutePath(
    absolutePath: string,
    allowProjectRoot = false
  ): string {
    if (
      !absolutePath.trim() ||
      absolutePath.includes("\0") ||
      !path.isAbsolute(absolutePath)
    ) {
      throw unsafePath(
        absolutePath,
        "Validated project path must be absolute."
      );
    }

    const candidate =
      path.resolve(absolutePath);

    const relative =
      path.relative(
        this.canonicalRoot,
        candidate
      );

    if (!relative) {
      if (allowProjectRoot) {
        return this.canonicalRoot;
      }

      throw unsafePath(
        absolutePath,
        "Project path must identify a child of the project root."
      );
    }

    return this.resolve(relative);
  }

  private assertSafeAncestors(
    segments: string[],
    originalPath: string
  ): void {
    let current =
      this.canonicalRoot;

    for (const segment of segments) {
      current = path.join(
        current,
        segment
      );

      try {
        const information =
          fs.lstatSync(current);

        if (
          information.isSymbolicLink()
        ) {
          throw unsafePath(
            originalPath,
            `Project path passes through a symbolic link or junction: ${segment}`
          );
        }

        const canonicalExistingPath =
          fs.realpathSync.native(
            current
          );

        assertInsideRoot(
          this.canonicalRoot,
          canonicalExistingPath,
          originalPath
        );
      } catch (error) {
        if (error instanceof AuroraError) {
          throw error;
        }

        const code =
          (
            error as NodeJS.ErrnoException
          ).code;

        if (code === "ENOENT") {
          return;
        }

        throw unsafePath(
          originalPath,
          "Project path cannot be safely resolved.",
          error
        );
      }
    }
  }
}

function validateRelativePath(
  relativePath: string
): string[] {
  if (
    !relativePath.trim() ||
    relativePath.includes("\0") ||
    path.isAbsolute(relativePath) ||
    path.posix.isAbsolute(
      relativePath
    ) ||
    path.win32.isAbsolute(
      relativePath
    ) ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    throw unsafePath(
      relativePath,
      "Project path must be relative."
    );
  }

  const segments =
    relativePath
      .split(/[\\/]+/u)
      .filter(
        segment =>
          segment.length > 0 &&
          segment !== "."
      );

  if (
    segments.length === 0 ||
    segments.includes("..")
  ) {
    throw unsafePath(
      relativePath,
      "Project path escapes the project root."
    );
  }

  const reservedWindowsName =
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

  const hasUnsafeSegment =
    segments.some(
      segment =>
        /[\u0000-\u001f]/u.test(
          segment
        ) ||
        segment.includes(":") ||
        /[. ]$/u.test(segment) ||
        reservedWindowsName.test(
          segment
        )
    );

  if (hasUnsafeSegment) {
    throw unsafePath(
      relativePath,
      "Project path contains a platform-unsafe segment."
    );
  }

  return segments;
}

function assertInsideRoot(
  projectRoot: string,
  candidate: string,
  originalPath: string
): void {
  const relative =
    path.relative(
      projectRoot,
      candidate
    );

  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(
      `..${path.sep}`
    ) ||
    path.isAbsolute(relative)
  ) {
    throw unsafePath(
      originalPath,
      "Project path escapes the project root."
    );
  }
}

function unsafePath(
  projectPath: string,
  reason: string,
  cause?: unknown
): AuroraError {
  return new AuroraError(
    `${reason} Received '${projectPath}'.`,
    {
      code:
        ErrorCodes.UNSAFE_PROJECT_PATH,
      suggestion:
        PATH_SUGGESTION,
      cause,
    }
  );
}
