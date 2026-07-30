import fs from "fs/promises";
import path from "path";

export async function installTemplates(
  packageId: string,
  projectPath: string
): Promise<void> {

  const templateDir = path.join(
    process.cwd(),
    "packages",
    packageId,
    "templates"
  );
console.log("Template directory:", templateDir);

  try {

    const files = await fs.readdir(templateDir);
console.log("Template files:", files);

    for (const file of files) {

      const source = path.join(
        templateDir,
        file
      );

      const target = path.join(
        projectPath,
        "src",
        file.replace(".template", "")
      );

      await fs.mkdir(
        path.dirname(target),
        {
          recursive: true
        }
      );

      const content =
        await fs.readFile(
          source,
          "utf8"
        );

      await fs.writeFile(
        target,
        content
      );

      console.log(
        `Installed template ${file}`
      );

    }

 } catch (error) {

  console.error(
    "Template installer error:",
    error
  );

}

}