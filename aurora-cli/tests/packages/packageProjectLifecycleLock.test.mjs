import assert from "node:assert/strict";

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";

import {
  createHash,
} from "node:crypto";

import {
  execFile,
} from "node:child_process";

import {
  hostname,
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  pathToFileURL,
} from "node:url";

import {
  promisify,
} from "node:util";

import test from "node:test";

import {
  ProjectLifecycleLock,
} from "../../dist/packages/lifecycle/projectLifecycleLock.js";

const execFileAsync =
  promisify(
    execFile
  );

const MODULE_URL =
  new URL(
    "../../dist/packages/lifecycle/projectLifecycleLock.js",
    import.meta.url
  ).href;

const ACQUIRE_OPTIONS = {
  acquisitionTimeoutMs:
    250,
  pollIntervalMs:
    5,
};

async function temporaryProject(
  prefix
) {
  return mkdtemp(
    join(
      tmpdir(),
      prefix
    )
  );
}

function lockFile(
  project
) {
  return join(
    project,
    ".aurora",
    "lifecycle-lock"
  );
}

async function assertMissing(
  target
) {
  await assert.rejects(
    access(
      target
    ),
    error =>
      error?.code ===
      "ENOENT"
  );
}

async function readOwner(
  project
) {
  return JSON.parse(
    await readFile(
      lockFile(
        project
      ),
      "utf8"
    )
  );
}

async function runChild(
  project,
  source
) {
  return execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      source,
      project,
    ],
    {
      cwd:
        process.cwd(),
      windowsHide:
        true,
      timeout:
        5000,
    }
  );
}

function acquireAndExitSource() {
  return `
    import { ProjectLifecycleLock } from ${JSON.stringify(MODULE_URL)};
    const project = process.argv[1];
    const lock = await ProjectLifecycleLock.acquire(
      project,
      { acquisitionTimeoutMs: 1000, pollIntervalMs: 5 }
    );
    process.stdout.write(JSON.stringify({
      token: lock.ownerToken,
      projectRoot: lock.projectRoot,
      held: lock.isHeld
    }));
  `;
}

function contendSource() {
  return `
    import { ProjectLifecycleLock } from ${JSON.stringify(MODULE_URL)};
    const project = process.argv[1];
    try {
      await ProjectLifecycleLock.acquire(
        project,
        { acquisitionTimeoutMs: 100, pollIntervalMs: 5 }
      );
      process.stdout.write("unexpected-acquire");
      process.exitCode = 2;
    } catch (error) {
      process.stdout.write(String(error?.message ?? error));
    }
  `;
}

test(
  "ProjectLifecycleLock publishes a complete owner file for the canonical project",
  async () => {
    const project =
      await temporaryProject(
        "aurora-project-lock-owner-"
      );

    let lock;

    try {
      lock =
        await ProjectLifecycleLock
          .acquire(
            project,
            ACQUIRE_OPTIONS
          );

      const expectedRoot =
        await realpath(
          project
        );

      assert.equal(
        lock.projectRoot,
        expectedRoot
      );

      assert.equal(
        lock.isHeld,
        true
      );

      assert.match(
        lock.ownerToken,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      );

      const information =
        await stat(
          lockFile(
            project
          )
        );

      assert.equal(
        information.isFile(),
        true
      );

      const owner =
        await readOwner(
          project
        );

      assert.deepEqual(
        Object.keys(
          owner
        ).sort(),
        [
          "acquiredAt",
          "hostname",
          "pid",
          "projectRootSha256",
          "schemaVersion",
          "token",
        ]
      );

      assert.equal(
        owner.schemaVersion,
        1
      );

      assert.equal(
        owner.token,
        lock.ownerToken
      );

      assert.equal(
        owner.pid,
        process.pid
      );

      assert.equal(
        owner.hostname,
        hostname()
      );

      assert.equal(
        owner.projectRootSha256,
        createHash(
          "sha256"
        )
          .update(
            expectedRoot,
            "utf8"
          )
          .digest(
            "hex"
          )
      );

      assert.equal(
        new Date(
          owner.acquiredAt
        ).toISOString(),
        owner.acquiredAt
      );
    }
    finally {
      await lock?.release();

      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "same-project acquisition times out without stealing a live owner",
  async () => {
    const project =
      await temporaryProject(
        "aurora-project-lock-live-"
      );

    let first;

    try {
      first =
        await ProjectLifecycleLock
          .acquire(
            project,
            ACQUIRE_OPTIONS
          );

      const before =
        await readFile(
          lockFile(
            project
          )
        );

      await assert.rejects(
        ProjectLifecycleLock
          .acquire(
            project,
            {
              acquisitionTimeoutMs:
                60,
              pollIntervalMs:
                5,
            }
          ),
        /Timed out after 60 ms waiting for the Aurora project lifecycle lock\./u
      );

      const after =
        await readFile(
          lockFile(
            project
          )
        );

      assert.deepEqual(
        after,
        before
      );

      assert.equal(
        first.isHeld,
        true
      );
    }
    finally {
      await first?.release();

      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "different projects acquire independently",
  async () => {
    const firstProject =
      await temporaryProject(
        "aurora-project-lock-independent-a-"
      );

    const secondProject =
      await temporaryProject(
        "aurora-project-lock-independent-b-"
      );

    let first;
    let second;

    try {
      [
        first,
        second,
      ] =
        await Promise.all([
          ProjectLifecycleLock
            .acquire(
              firstProject,
              ACQUIRE_OPTIONS
            ),
          ProjectLifecycleLock
            .acquire(
              secondProject,
              ACQUIRE_OPTIONS
            ),
        ]);

      assert.equal(
        first.isHeld,
        true
      );

      assert.equal(
        second.isHeld,
        true
      );

      assert.notEqual(
        first.projectRoot,
        second.projectRoot
      );
    }
    finally {
      await first?.release();
      await second?.release();

      await rm(
        firstProject,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        secondProject,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "release removes authority and permits reacquisition",
  async () => {
    const project =
      await temporaryProject(
        "aurora-project-lock-release-"
      );

    try {
      const first =
        await ProjectLifecycleLock
          .acquire(
            project,
            ACQUIRE_OPTIONS
          );

      const firstToken =
        first.ownerToken;

      await first.release();

      assert.equal(
        first.isHeld,
        false
      );

      await assertMissing(
        lockFile(
          project
        )
      );

      const second =
        await ProjectLifecycleLock
          .acquire(
            project,
            ACQUIRE_OPTIONS
          );

      try {
        assert.notEqual(
          second.ownerToken,
          firstToken
        );

        assert.equal(
          second.isHeld,
          true
        );
      }
      finally {
        await second.release();
      }
    }
    finally {
      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "concurrent release calls on one lock instance fail closed",
  async () => {
    const project =
      await temporaryProject(
        "aurora-project-lock-concurrent-release-"
      );

    let lock;

    try {
      lock =
        await ProjectLifecycleLock
          .acquire(
            project,
            ACQUIRE_OPTIONS
          );

      const firstRelease =
        lock.release();

      /*
       * release() sets its in-progress guard synchronously before its first
       * await, so this second call deterministically exercises the overlap.
       */
      await assert.rejects(
        lock.release(),
        /release is already in progress/u
      );

      await firstRelease;

      assert.equal(
        lock.isHeld,
        false
      );

      await assertMissing(
        lockFile(
          project
        )
      );
    }
    finally {
      if (lock?.isHeld) {
        await lock.release();
      }

      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "release fails closed if authoritative ownership changes",
  async () => {
    const project =
      await temporaryProject(
        "aurora-project-lock-release-owner-"
      );

    let lock;

    try {
      lock =
        await ProjectLifecycleLock
          .acquire(
            project,
            ACQUIRE_OPTIONS
          );

      const owner =
        await readOwner(
          project
        );

      owner.token =
        "11111111-1111-4111-8111-111111111111";

      await writeFile(
        lockFile(
          project
        ),
        `${JSON.stringify(
          owner
        )}\n`,
        "utf8"
      );

      await assert.rejects(
        lock.release(),
        /Cannot release Aurora project lifecycle lock because ownership changed\./u
      );

      assert.equal(
        lock.isHeld,
        true
      );

      const changed =
        await readOwner(
          project
        );

      assert.equal(
        changed.token,
        owner.token
      );

      lock =
        undefined;
    }
    finally {
      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "malformed authoritative owner metadata fails closed",
  async () => {
    const project =
      await temporaryProject(
        "aurora-project-lock-malformed-"
      );

    try {
      await mkdir(
        join(
          project,
          ".aurora"
        ),
        {
          recursive: true,
        }
      );

      await writeFile(
        lockFile(
          project
        ),
        "{not-json",
        "utf8"
      );

      await assert.rejects(
        ProjectLifecycleLock
          .acquire(
            project,
            {
              acquisitionTimeoutMs:
                50,
              pollIntervalMs:
                5,
            }
          ),
        /owner metadata contains invalid JSON/u
      );

      assert.equal(
        await readFile(
          lockFile(
            project
          ),
          "utf8"
        ),
        "{not-json"
      );
    }
    finally {
      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "valid foreign-host ownership is not reclaimed",
  async () => {
    const project =
      await temporaryProject(
        "aurora-project-lock-foreign-"
      );

    try {
      const seed =
        await ProjectLifecycleLock
          .acquire(
            project,
            ACQUIRE_OPTIONS
          );

      const owner =
        await readOwner(
          project
        );

      await seed.release();

      owner.hostname =
        "foreign-host.invalid";

      await writeFile(
        lockFile(
          project
        ),
        `${JSON.stringify(
          owner
        )}\n`,
        "utf8"
      );

      const before =
        await readFile(
          lockFile(
            project
          )
        );

      await assert.rejects(
        ProjectLifecycleLock
          .acquire(
            project,
            {
              acquisitionTimeoutMs:
                60,
              pollIntervalMs:
                5,
            }
          ),
        /Timed out after 60 ms waiting for the Aurora project lifecycle lock\./u
      );

      const after =
        await readFile(
          lockFile(
            project
          )
        );

      assert.deepEqual(
        after,
        before
      );
    }
    finally {
      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "dead same-host child ownership is reclaimed conservatively",
  {
    timeout:
      10000,
  },
  async () => {
    const project =
      await temporaryProject(
        "aurora-project-lock-stale-child-"
      );

    let recovered;

    try {
      const child =
        await runChild(
          project,
          acquireAndExitSource()
        );

      const childResult =
        JSON.parse(
          child.stdout
        );

      assert.equal(
        childResult.held,
        true
      );

      const staleOwner =
        await readOwner(
          project
        );

      assert.equal(
        staleOwner.token,
        childResult.token
      );

      assert.notEqual(
        staleOwner.pid,
        process.pid
      );

      recovered =
        await ProjectLifecycleLock
          .acquire(
            project,
            {
              acquisitionTimeoutMs:
                1000,
              pollIntervalMs:
                5,
            }
          );

      assert.equal(
        recovered.isHeld,
        true
      );

      assert.notEqual(
        recovered.ownerToken,
        childResult.token
      );

      const current =
        await readOwner(
          project
        );

      assert.equal(
        current.token,
        recovered.ownerToken
      );
    }
    finally {
      await recovered?.release();

      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "an existing reclaim guard fails closed without stealing stale-owner recovery",
  {
    timeout:
      10000,
  },
  async () => {
    const project =
      await temporaryProject(
        "aurora-project-lock-reclaim-guard-"
      );

    let recovered;

    try {
      const child =
        await runChild(
          project,
          acquireAndExitSource()
        );

      const childResult =
        JSON.parse(
          child.stdout
        );

      assert.equal(
        childResult.held,
        true
      );

      const staleOwner =
        await readOwner(
          project
        );

      assert.equal(
        staleOwner.token,
        childResult.token
      );

      assert.notEqual(
        staleOwner.pid,
        process.pid
      );

      const guard =
        join(
          project,
          ".aurora",
          `.lifecycle-lock-reclaim-${staleOwner.token}`
        );

      const before =
        await readFile(
          lockFile(
            project
          )
        );

      await mkdir(
        guard,
        {
          recursive: false,
        }
      );

      await assert.rejects(
        ProjectLifecycleLock
          .acquire(
            project,
            {
              acquisitionTimeoutMs:
                60,
              pollIntervalMs:
                5,
            }
          ),
        /Timed out after 60 ms waiting for the Aurora project lifecycle lock./u
      );

      const guardInformation =
        await stat(
          guard
        );

      assert.equal(
        guardInformation.isDirectory(),
        true
      );

      const after =
        await readFile(
          lockFile(
            project
          )
        );

      assert.deepEqual(
        after,
        before
      );

      const guardedOwner =
        await readOwner(
          project
        );

      assert.equal(
        guardedOwner.token,
        staleOwner.token
      );

      await rm(
        guard,
        {
          recursive: true,
          force: true,
        }
      );

      recovered =
        await ProjectLifecycleLock
          .acquire(
            project,
            {
              acquisitionTimeoutMs:
                1000,
              pollIntervalMs:
                5,
            }
          );

      assert.equal(
        recovered.isHeld,
        true
      );

      assert.notEqual(
        recovered.ownerToken,
        staleOwner.token
      );

      const current =
        await readOwner(
          project
        );

      assert.equal(
        current.token,
        recovered.ownerToken
      );
    }
    finally {
      await recovered?.release();

      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "a separate Node process cannot overlap a live same-project owner",
  {
    timeout:
      10000,
  },
  async () => {
    const project =
      await temporaryProject(
        "aurora-project-lock-child-contention-"
      );

    let lock;

    try {
      lock =
        await ProjectLifecycleLock
          .acquire(
            project,
            ACQUIRE_OPTIONS
          );

      const ownerBefore =
        await readOwner(
          project
        );

      const child =
        await runChild(
          project,
          contendSource()
        );

      assert.match(
        child.stdout,
        /Timed out after 100 ms waiting for the Aurora project lifecycle lock\./u
      );

      assert.notEqual(
        child.stdout,
        "unexpected-acquire"
      );

      const ownerAfter =
        await readOwner(
          project
        );

      assert.deepEqual(
        ownerAfter,
        ownerBefore
      );

      assert.equal(
        lock.isHeld,
        true
      );
    }
    finally {
      await lock?.release();

      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "a symbolic-link or junction .aurora boundary is rejected",
  async t => {
    const project =
      await temporaryProject(
        "aurora-project-lock-boundary-"
      );

    const external =
      await temporaryProject(
        "aurora-project-lock-external-"
      );

    try {
      try {
        await symlink(
          external,
          join(
            project,
            ".aurora"
          ),
          process.platform ===
            "win32"
            ? "junction"
            : "dir"
        );
      }
      catch (error) {
        if (
          error?.code ===
            "EPERM" ||
          error?.code ===
            "EACCES"
        ) {
          t.skip(
            `Platform does not permit creating the test link: ${error.code}`
          );
          return;
        }

        throw error;
      }

      await assert.rejects(
        ProjectLifecycleLock
          .acquire(
            project,
            ACQUIRE_OPTIONS
          ),
        /symbolic link|junction|unsafe|Project path/u
      );

      await assertMissing(
        join(
          external,
          "lifecycle-lock"
        )
      );
    }
    finally {
      await rm(
        project,
        {
          recursive: true,
          force: true,
        }
      );

      await rm(
        external,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
