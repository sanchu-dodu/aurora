import {
  getTemplateById,
  searchTemplates,
} from "../services/templateService.js";

import {
  createTemplateProject,
  previewTemplateInstallation,
} from "../services/installService.js";
import { redactSensitiveValue } from "../security/secretRedactor.js";

import {
  AuroraError,
} from "../errors/AuroraError.js";

import {
  ErrorCodes,
} from "../errors/errorCodes.js";

export async function templateInfoCommand(
  id: string
): Promise<void> {
  const template =
    await getTemplateById(id);

  if (!template) {
    throw new AuroraError(
      `Template '${id}' not found.`,
      {
        code:
          ErrorCodes
            .TEMPLATE_NOT_FOUND,

        suggestion:
          "Run 'aurora template search <query>' to discover available templates.",
      }
    );
  }

  console.log("");
  console.log(
    "Template Information"
  );
  console.log(
    "===================="
  );
  console.log("");

  console.log(
    `Name: ${template.displayName}`
  );

  console.log(
    `ID: ${template.id}`
  );

  console.log(
    `Version: ${template.version}`
  );

  console.log(
    `Description: ${template.description}`
  );

  console.log(
    `Author: ${template.author}`
  );

  console.log(
    `Framework: ${template.framework}`
  );

  console.log(
    `Tags: ${template.tags.join(", ")}`
  );
}

export async function templateSearchCommand(
  query: string
): Promise<void> {
  const matches =
    await searchTemplates(query);

  console.log("");
  console.log(
    "Search Results"
  );
  console.log(
    "=============="
  );

  if (
    matches.length === 0
  ) {
    console.log(
      "No templates found."
    );

    return;
  }

  for (
    const template
    of matches
  ) {
    console.log("");

    console.log(
      `🚀 ${template.displayName}`
    );

    console.log(
      `ID: ${template.id}`
    );

    console.log(
      `Version: ${template.version}`
    );

    console.log(
      `Framework: ${template.framework}`
    );

    console.log(
      `Tags: ${template.tags.join(", ")}`
    );
  }
}

export interface TemplateInstallOptions {
  readonly workspace?: string;
  readonly dryRun?: boolean;
  readonly json?: boolean;
}

export async function templateInstallCommand(
  id: string,
  projectName: string,
  options: TemplateInstallOptions = {}
): Promise<void> {
  // The install command needs only the bundled template, not the runtime catalog.
  await import("../templates/registerNext.js");
  const projectCreation = { workspaceRoot: options.workspace, silent: options.json };
  if (options.dryRun) {
    const preview = await previewTemplateInstallation(id, projectName, projectCreation);
    if (options.json) console.log(JSON.stringify(redactSensitiveValue(preview), null, 2));
    else {
      console.log(`Would install template ${preview.template.id}: ${preview.root}`);
      console.log(`Package manager: ${preview.packageManager}`);
      for (const file of preview.files) console.log(`  ${file}`);
      console.log("Dry run: no files, dependencies, or Git changes.");
    }
    return;
  }

  if (options.json) {
    const result = await createTemplateProject(id, projectName, { projectCreation });
    console.log(JSON.stringify(redactSensitiveValue(result), null, 2));
    return;
  }

  console.log("");
  console.log(
    "Installing Template"
  );
  console.log(
    "==================="
  );

  await createTemplateProject(
    id,
    projectName,
    { projectCreation }
  );

  console.log("");
  console.log(
    "🎉 Project created successfully!"
  );

  console.log(
    `Project: ${projectName}`
  );
}
