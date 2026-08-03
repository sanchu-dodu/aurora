import {
  getTemplateById,
  searchTemplates,
} from "../services/templateService.js";

import {
  installProject,
} from "../services/installService.js";

export async function templateInfoCommand(
  id: string
): Promise<void> {
  const template =
    await getTemplateById(id);

  if (!template) {
    throw new Error(
      `Template '${id}' not found.`
    );
  }

  console.log("");
  console.log("Template Information");
  console.log("====================");
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
  console.log("Search Results");
  console.log("==============");

  if (matches.length === 0) {
    console.log(
      "No templates found."
    );

    return;
  }

  for (const template of matches) {
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

export async function templateInstallCommand(
  id: string,
  projectName: string
): Promise<void> {
  console.log("");
  console.log("Installing Template");
  console.log("===================");

  await installProject(
    id,
    projectName
  );

  console.log("");
  console.log(
    "🎉 Project created successfully!"
  );

  console.log(
    `Project: ${projectName}`
  );
}