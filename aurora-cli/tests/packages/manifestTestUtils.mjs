import {
  createHash,
} from "node:crypto";

import {
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";

import {
  join,
} from "node:path";

import {
  calculateArtifactDigest,
} from "../../dist/packages/integrity/packageArtifactVerifier.js";

async function collectFiles(
  directory,
  relativeDirectory = ""
) {
  const entries =
    await readdir(
      directory,
      {
        withFileTypes: true,
      }
    );

  const files = [];

  for (const entry of entries) {
    const relativePath =
      relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;

    if (
      relativePath ===
      "manifest.json"
    ) {
      continue;
    }

    const absolutePath =
      join(
        directory,
        entry.name
      );

    if (entry.isDirectory()) {
      files.push(
        ...(
          await collectFiles(
            absolutePath,
            relativePath
          )
        )
      );
      continue;
    }

    files.push({
      path: relativePath,
      absolutePath,
    });
  }

  return files;
}

function inferRole(path) {
  if (path === "install.js") {
    return "installer";
  }

  if (path.startsWith("hooks/")) {
    return "hook";
  }

  if (path.startsWith("templates/")) {
    return "template";
  }

  if (path.startsWith("migrations/")) {
    return "migration";
  }

  return "asset";
}

export function createManifestV1(
  overrides = {}
) {
  const id =
    overrides.id ?? "example";

  const version =
    overrides.version ?? "1.0.0";

  return {
    manifestVersion: 1,
    kind: "package",
    id,
    name:
      overrides.name ?? id,
    version,
    description:
      overrides.description ??
      `Manifest v1 test package ${id}.`,
    category:
      overrides.category ?? "testing",
    tags:
      overrides.tags ?? [
        "test",
      ],
    frameworks:
      overrides.frameworks ?? [
        "agnostic",
      ],
    compatibility:
      overrides.compatibility ?? {
        aurora:
          ">=0.1.0 <1.0.0",
        node: ">=22.0.0",
      },
    publisher:
      overrides.publisher ?? {
        id: "aurora-tests",
        name: "Aurora Tests",
        url:
          "https://example.com/aurora-tests",
      },
    artifact:
      overrides.artifact ?? {
        algorithm: "sha256",
        digest:
          createHash("sha256")
            .update("")
            .digest("hex"),
      },
    provenance:
      overrides.provenance ?? {
        type: "source",
        url:
          "https://example.com/aurora-tests/source",
        reference:
          `${id}@${version}`,
      },
    dependencies:
      overrides.dependencies ?? [],
    conflicts:
      overrides.conflicts ?? [],
    capabilities:
      overrides.capabilities ?? [],
    files:
      overrides.files ?? [],
    migrations:
      overrides.migrations ?? [],
    environment:
      overrides.environment ?? [],
    platforms:
      overrides.platforms ?? {
        os: ["any"],
        architecture: ["any"],
      },
    lifecycle:
      overrides.lifecycle ?? {
        deprecated: false,
        revoked: false,
      },
    links:
      overrides.links ?? {},
    ...overrides,
  };
}

export async function writePackageManifestV1(
  packageDirectory,
  overrides = {}
) {
  const artifactFiles =
    await collectFiles(
      packageDirectory
    );

  const files = [];

  for (const file of artifactFiles) {
    files.push({
      path: file.path,
      role:
        overrides.fileRoles
          ?.[file.path] ??
        inferRole(file.path),
      digest:
        createHash("sha256")
          .update(
            await readFile(
              file.absolutePath
            )
          )
          .digest("hex"),
    });
  }

  const inferredCapabilities = [];

  if (
    files.some(
      (file) =>
        [
          "installer",
          "hook",
          "migration",
        ].includes(file.role)
    )
  ) {
    inferredCapabilities.push(
      "package.code.execute"
    );
  }

  if (
    files.some(
      (file) =>
        file.role === "template"
    )
  ) {
    inferredCapabilities.push(
      "project.files.write"
    );
  }

  if (
    overrides.environment?.length > 0
  ) {
    inferredCapabilities.push(
      "project.environment.write"
    );
  }

  const {
    fileRoles: _fileRoles,
    ...manifestOverrides
  } = overrides;

  const manifest =
    createManifestV1({
      ...manifestOverrides,
      files,
      capabilities:
        overrides.capabilities ??
        inferredCapabilities,
      artifact: {
        algorithm: "sha256",
        digest:
          calculateArtifactDigest(
            files
          ),
      },
    });

  await writeFile(
    join(
      packageDirectory,
      "manifest.json"
    ),
    `${JSON.stringify(
      manifest,
      null,
      2
    )}\n`,
    "utf8"
  );

  return manifest;
}
