import type {
  ProjectConfig,
} from "../types/project.js";

export function shouldGenerateFile(
  file: string,
  _config: ProjectConfig
): boolean {
  const normalized =
    file.replaceAll(
      "\\",
      "/"
    );

  return normalized !==
    "template.json";
}
