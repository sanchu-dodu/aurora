import fs from "fs-extra";
import path from "path";

export async function validateTemplate(
  templatePath: string
): Promise<void> {
  const requiredFiles = [
    "template.json",
    "package.json",
  ];

  for (const file of requiredFiles) {
    const exists = await fs.pathExists(
      path.join(templatePath, file)
    );

    if (!exists) {
      throw new Error(
        `Template is missing required file: ${file}`
      );
    }
  }
}