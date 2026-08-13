import fs from "node:fs/promises";
import path from "node:path";

import {
  ProjectPathBoundary,
} from "../../security/projectPathBoundary.js";

import type {
  PackageManifest,
} from "../manifestSchema.js";

import {
  getDefaultPackageRoot,
} from "../packagePaths.js";

import type {
  InstallerContext,
} from "./installerContext.js";

export async function installTemplates(
  manifest: PackageManifest,
  context: InstallerContext,
  packageRoot = getDefaultPackageRoot()
): Promise<void> {
  const packageBoundary =
    new ProjectPathBoundary(
      packageRoot
    );

  const templates =
    manifest.files.filter(
      (file) =>
        file.role === "template"
    );

  for (const template of templates) {
    const source =
      packageBoundary.resolve(
        `${manifest.id}/${template.path}`
      );

    const relativeTemplatePath =
      template.path
        .slice("templates/".length)
        .replace(/\.template$/, "");

    const targetPath = path.join(
      "src",
      ...relativeTemplatePath.split("/")
    );

    const target =
      context.resolveProjectPath(
        targetPath
      );

    const content =
      await fs.readFile(
        source,
        "utf8"
      );

    await context.transaction
      .recordModifiedFile(target);

    await fs.mkdir(
      path.dirname(target),
      {
        recursive: true,
      }
    );

    await fs.writeFile(
      context.resolveProjectPath(
        targetPath
      ),
      content,
      "utf8"
    );

    console.log(
      `Installed template ${template.path}`
    );
  }
}
