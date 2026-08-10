import fs from "node:fs/promises";
import path from "node:path";

import type {
  FileTransaction,
} from "../../core/fileTransaction.js";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

export interface FeatureManifest {
  installed: string[];
}

function getManifestPath(
  projectPath: string
): string {
  return new ProjectPathBoundary(
    projectPath
  ).resolve(
    ".aurora/features.json"
  );
}

export async function loadManifest(
  projectPath: string
): Promise<FeatureManifest> {
  const file =
    getManifestPath(
      projectPath
    );

  try {
    const manifest =
      JSON.parse(
        await fs.readFile(
          file,
          "utf8"
        )
      ) as Partial<FeatureManifest>;

    if (
      !Array.isArray(
        manifest.installed
      )
    ) {
      throw new Error(
        `Invalid feature manifest: ${file}`
      );
    }

    return {
      installed:
        manifest.installed,
    };
  } catch (error) {
    const code =
      (
        error as NodeJS.ErrnoException
      ).code;

    if (code === "ENOENT") {
      return {
        installed: [],
      };
    }

    throw error;
  }
}

export async function saveManifest(
  projectPath: string,
  manifest: FeatureManifest,
  transaction?: FileTransaction
): Promise<void> {
  const file =
    getManifestPath(
      projectPath
    );

  if (transaction) {
    await transaction
      .recordModifiedFile(file);

    await transaction
      .ensureDirectory(
        path.dirname(file)
      );
  } else {
    await fs.mkdir(
      path.dirname(file),
      {
        recursive: true,
      }
    );
  }

  await fs.writeFile(
    file,
    JSON.stringify(
      manifest,
      null,
      2
    ) + "\n",
    "utf8"
  );
}

export async function isInstalled(
  projectPath: string,
  featureId: string
): Promise<boolean> {
  const manifest =
    await loadManifest(
      projectPath
    );

  return manifest.installed.includes(
    featureId
  );
}

export async function addInstalledFeature(
  projectPath: string,
  featureId: string,
  transaction?: FileTransaction
): Promise<void> {
  const manifest =
    await loadManifest(
      projectPath
    );

  if (
    !manifest.installed.includes(
      featureId
    )
  ) {
    manifest.installed.push(
      featureId
    );
  }

  await saveManifest(
    projectPath,
    manifest,
    transaction
  );
}
