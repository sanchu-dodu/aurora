import test from "node:test";
import assert from "node:assert/strict";

import {
  validatePackage,
} from "../../dist/packages/packageValidator.js";

import {
  createPackageSigningPayload,
} from "../../dist/packages/trust/packageSigningPayload.js";

import {
  createManifestV1,
} from "./manifestTestUtils.mjs";

function assertInvalid(
  manifest,
  message
) {
  assert.throws(
    () => validatePackage(manifest),
    error => {
      assert.equal(
        error.code,
        "INVALID_PACKAGE_MANIFEST"
      );

      assert.match(
        error.message,
        message
      );

      return true;
    }
  );
}

test(
  "existing manifests remain shape-compatible without projectFileReads",
  () => {
    const manifest =
      createManifestV1();

    const validated =
      validatePackage(manifest);

    assert.equal(
      Object.hasOwn(
        manifest,
        "projectFileReads"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        validated,
        "projectFileReads"
      ),
      false
    );
  }
);

test(
  "Manifest v1 accepts explicit project file read declarations",
  () => {
    const validated =
      validatePackage(
        createManifestV1({
          capabilities: [
            "project.files.read",
          ],
          projectFileReads: [
            {
              path: "package.json",
              required: true,
            },
            {
              path: "config/app.json",
              required: false,
            },
          ],
        })
      );

    assert.equal(
      validated.projectFileReads.length,
      2
    );

    assert.deepEqual(
      validated.projectFileReads[0],
      {
        path: "package.json",
        required: true,
      }
    );
  }
);

test(
  "project file read declarations require project.files.read",
  () => {
    assertInvalid(
      createManifestV1({
        projectFileReads: [
          {
            path: "config/app.json",
            required: true,
          },
        ],
      }),
      /project\.files\.read/
    );
  }
);

test(
  "project.files.read requires explicitly declared project files",
  () => {
    assertInvalid(
      createManifestV1({
        capabilities: [
          "project.files.read",
        ],
      }),
      /explicitly declared project file/
    );

    assertInvalid(
      createManifestV1({
        capabilities: [
          "project.files.read",
        ],
        projectFileReads: [],
      }),
      /explicitly declared project file/
    );
  }
);

test(
  "duplicate project file read paths fail closed",
  () => {
    assertInvalid(
      createManifestV1({
        capabilities: [
          "project.files.read",
        ],
        projectFileReads: [
          {
            path: "config/app.json",
            required: true,
          },
          {
            path: "config/app.json",
            required: false,
          },
        ],
      }),
      /projectFileReads cannot contain duplicate values/
    );
  }
);

test(
  "project file read paths require canonical relative POSIX form",
  () => {
    for (const path of [
      "../package.json",
      "/package.json",
      "C:/package.json",
      "src\\config.ts",
      "./src/config.ts",
      "src/../config.ts",
      "src/./config.ts",
      "src//config.ts",
      "src/",
      "src/*.ts",
    ]) {
      assertInvalid(
        createManifestV1({
          capabilities: [
            "project.files.read",
          ],
          projectFileReads: [
            {
              path,
              required: true,
            },
          ],
        }),
        /canonical relative POSIX paths/
      );
    }
  }
);

test(
  "project file read declarations are limited to fifty entries",
  () => {
    const declarations =
      Array.from(
        { length: 50 },
        (_, index) => ({
          path: `config/file-${index}.json`,
          required: false,
        })
      );

    const validated =
      validatePackage(
        createManifestV1({
          capabilities: [
            "project.files.read",
          ],
          projectFileReads:
            declarations,
        })
      );

    assert.equal(
      validated.projectFileReads.length,
      50
    );

    assertInvalid(
      createManifestV1({
        capabilities: [
          "project.files.read",
        ],
        projectFileReads: [
          ...declarations,
          {
            path: "config/overflow.json",
            required: false,
          },
        ],
      }),
      /50|too big|at most/i
    );
  }
);

test(
  "project file read declarations reject unknown metadata",
  () => {
    for (const key of [
      "glob",
      "directory",
      "secret",
    ]) {
      assertInvalid(
        createManifestV1({
          capabilities: [
            "project.files.read",
          ],
          projectFileReads: [
            {
              path: "config/app.json",
              required: true,
              [key]: true,
            },
          ],
        }),
        new RegExp(key)
      );
    }
  }
);

test(
  "project file read declarations are cryptographically bound",
  () => {
    const base =
      createManifestV1();

    const required = {
      ...base,
      capabilities: [
        "project.files.read",
      ],
      projectFileReads: [
        {
          path: "config/app.json",
          required: true,
        },
      ],
    };

    const optional = {
      ...required,
      projectFileReads: [
        {
          path: "config/app.json",
          required: false,
        },
      ],
    };

    const alternatePath = {
      ...required,
      projectFileReads: [
        {
          path: "config/other.json",
          required: true,
        },
      ],
    };

    assert.notDeepEqual(
      createPackageSigningPayload(base),
      createPackageSigningPayload(required)
    );

    assert.notDeepEqual(
      createPackageSigningPayload(required),
      createPackageSigningPayload(optional)
    );

    assert.notDeepEqual(
      createPackageSigningPayload(required),
      createPackageSigningPayload(
        alternatePath
      )
    );
  }
);
