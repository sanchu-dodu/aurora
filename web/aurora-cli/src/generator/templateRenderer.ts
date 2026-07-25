import fs from "fs-extra";

export class TemplateRenderer {

  async render(
    templatePath: string,
    variables: Record<string, string>
  ): Promise<string> {

    let content =
      await fs.readFile(
        templatePath,
        "utf8"
      );

    for (const key of Object.keys(variables)) {

      const value =
        variables[key];

      content =
        content.replaceAll(
          `{{${key}}}`,
          value
        );

    }

    return content;

  }

}