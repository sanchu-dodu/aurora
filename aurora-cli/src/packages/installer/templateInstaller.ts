import fs from "node:fs/promises";
import path from "node:path";

import type { InstallerContext } from "./installerContext.js";
import { getDefaultPackageRoot } from "../packagePaths.js";

export async function installTemplates(
  packageId: string,
  context: InstallerContext,
  packageRoot = getDefaultPackageRoot()
): Promise<void> {
  const templateDirectory = path.join(
    packageRoot,
    packageId,
    "templates"
  );

  let entries;

  try {
    entries = await fs.readdir(
      templateDirectory,
      {
        withFileTypes: true,
      }
    );
  } catch (error) {
    const code =
      (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return;
    }

    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const source = path.join(
      templateDirectory,
      entry.name
    );

    const targetPath =
      path.join(
        "src",
        entry.name.replace(
          ".template",
          ""
        )
      );

    const target =
      context.resolveProjectPath(
        targetPath
      );

    const content = await fs.readFile(
      source,
      "utf8"
    );

    await context.transaction.recordModifiedFile(
      target
    );

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
      `Installed template ${entry.name}`
    );
  }
}
