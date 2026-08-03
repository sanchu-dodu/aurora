import type {
  ProjectConfig,
} from "../types/project.js";

export function replaceVariables(
  content: string,
  config: ProjectConfig
): string {
  return content
    .replaceAll(
      "{{projectName}}",
      config.projectName
    )
    .replaceAll(
      "{{PROJECT_NAME}}",
      config.projectName
    )
    .replaceAll(
      "PROJECT_NAME_PLACEHOLDER",
      config.projectName
    )
    .replaceAll(
      "{{FRAMEWORK}}",
      config.framework
    )
    .replaceAll(
      "{{LANGUAGE}}",
      config.language
    )
    .replaceAll(
      "{{PACKAGE_MANAGER}}",
      config.packageManager
    );
}
