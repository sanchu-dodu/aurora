import test from "node:test";
import assert from "node:assert/strict";

import {
  access,
  mkdir,
  mkdtemp,
  rm,
  symlink,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  ErrorCodes,
} from "../../dist/errors/errorCodes.js";

import {
  ProjectPathBoundary,
} from "../../dist/security/projectPathBoundary.js";

import {
  InstallerContext,
} from "../../dist/packages/installer/installerContext.js";

import {
  CacheManager,
} from "../../dist/packages/cache/cacheManager.js";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isUnsafeProjectPath(error) {
  assert.equal(
    error.code,
    ErrorCodes.UNSAFE_PROJECT_PATH
  );

  assert.match(
    error.suggestion,
    /relative path/i
  );

  return true;
}

test(
  "Project path boundary resolves valid nested paths",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-path-valid-"
        )
      );

    try {
      const boundary =
        new ProjectPathBoundary(
          projectRoot
        );

      assert.equal(
        boundary.resolve(
          "src\\nested/component.ts"
        ),
        join(
          boundary.projectRoot,
          "src",
          "nested",
          "component.ts"
        )
      );

      assert.equal(
        boundary.validateAbsolutePath(
          join(
            boundary.projectRoot,
            "src",
            "absolute.ts"
          )
        ),
        join(
          boundary.projectRoot,
          "src",
          "absolute.ts"
        )
      );

      assert.equal(
        boundary.validateAbsolutePath(
          join(
            projectRoot,
            "src",
            "lexical-root.ts"
          )
        ),
        join(
          boundary.projectRoot,
          "src",
          "lexical-root.ts"
        )
      );

      assert.throws(
        () =>
          boundary.validateAbsolutePath(
            join(
              boundary.projectRoot,
              "..",
              "outside.ts"
            )
          ),
        isUnsafeProjectPath
      );
    } finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "Project path boundary validates absolute children through the original root alias",
  async () => {
    const sandbox =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-path-alias-"
        )
      );

    const projectRoot =
      join(sandbox, "project");

    const aliasRoot =
      join(sandbox, "project-alias");

    await mkdir(projectRoot);

    try {
      await symlink(
        projectRoot,
        aliasRoot,
        process.platform === "win32"
          ? "junction"
          : "dir"
      );

      const boundary =
        new ProjectPathBoundary(
          aliasRoot
        );

      assert.equal(
        boundary.validateAbsolutePath(
          join(
            aliasRoot,
            "src",
            "alias.ts"
          )
        ),
        join(
          boundary.projectRoot,
          "src",
          "alias.ts"
        )
      );
    } finally {
      await rm(
        aliasRoot,
        {
          force: true,
        }
      );

      await rm(
        sandbox,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "Project path boundary rejects traversal and cross-platform absolute paths",
  async () => {
    const projectRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-path-invalid-"
        )
      );

    try {
      const boundary =
        new ProjectPathBoundary(
          projectRoot
        );

      const unsafePaths = [
        "",
        ".",
        "../outside.txt",
        "nested/../../outside.txt",
        "nested\\..\\outside.txt",
        "/tmp/outside.txt",
        "\\\\server\\share\\outside.txt",
        "C:\\outside.txt",
        "C:outside.txt",
        "file.txt:stream",
        "CON",
        "folder/NUL.txt",
        "trailing./file.txt",
        "unsafe\0path.txt",
      ];

      for (const unsafePath of unsafePaths) {
        assert.throws(
          () =>
            boundary.resolve(
              unsafePath
            ),
          isUnsafeProjectPath
        );
      }
    } finally {
      await rm(
        projectRoot,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "Installer context cannot create a file outside the project",
  async () => {
    const sandbox =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-path-installer-"
        )
      );

    const projectRoot =
      join(sandbox, "project");

    const escapedFile =
      join(sandbox, "escaped.txt");

    await mkdir(projectRoot);

    try {
      const context =
        new InstallerContext(
          projectRoot
        );

      await assert.rejects(
        context.createFile(
          "../escaped.txt",
          "unsafe\n"
        ),
        isUnsafeProjectPath
      );

      assert.equal(
        await exists(escapedFile),
        false
      );
    } finally {
      await rm(
        sandbox,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "Project writes reject a symbolic-link or junction escape",
  async () => {
    const sandbox =
      await mkdtemp(
        join(
          tmpdir(),
          "aurora-safe-path-link-"
        )
      );

    const projectRoot =
      join(sandbox, "project");

    const outsideRoot =
      join(sandbox, "outside");

    const linkPath =
      join(projectRoot, ".aurora");

    await mkdir(projectRoot);
    await mkdir(outsideRoot);

    try {
      await symlink(
        outsideRoot,
        linkPath,
        process.platform === "win32"
          ? "junction"
          : "dir"
      );

      await assert.rejects(
        new CacheManager(
          projectRoot
        ).install(
          "unsafe-package",
          "1.0.0"
        ),
        isUnsafeProjectPath
      );

      assert.equal(
        await exists(
          join(
            outsideRoot,
            "cache.json"
          )
        ),
        false
      );
    } finally {
      await rm(
        linkPath,
        {
          force: true,
        }
      );

      await rm(
        sandbox,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
