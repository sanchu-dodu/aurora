import fs from "fs-extra";
import path from "path";

interface FeatureManifest {

  installed: string[];

}

async function manifestPath(
  projectPath: string
): Promise<string> {

  const aurora = path.join(
    projectPath,
    ".aurora"
  );

  await fs.ensureDir(aurora);

  return path.join(
    aurora,
    "features.json"
  );

}

export async function loadManifest(
  projectPath: string
): Promise<FeatureManifest> {

  const file =
    await manifestPath(projectPath);

  if (!(await fs.pathExists(file))) {

    return {
      installed: [],
    };

  }

  return fs.readJson(file);

}

export async function saveManifest(
  projectPath: string,
  manifest: FeatureManifest
): Promise<void> {

  const file =
    await manifestPath(projectPath);

  await fs.writeJson(
    file,
    manifest,
    {
      spaces: 2,
    }
  );

}

export async function isInstalled(
  projectPath: string,
  featureId: string
): Promise<boolean> {

  const manifest =
    await loadManifest(projectPath);

  return manifest.installed.includes(
    featureId
  );

}

export async function addInstalledFeature(
  projectPath: string,
  featureId: string
): Promise<void> {

  const manifest =
    await loadManifest(projectPath);

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
    manifest
  );

}