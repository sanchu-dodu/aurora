import type { ProjectConfig } from "../types/project.js";

export function replaceVariables(
  content: string,
  config: ProjectConfig
): string {
  return content
    .replace(/{{projectName}}/g, config.projectName)
    .replace(/PROJECT_NAME_PLACEHOLDER/g, config.projectName)
    .replace(/{{FRAMEWORK}}/g, config.framework)
    .replace(/{{LANGUAGE}}/g, config.language)
    .replace(/{{PACKAGE_MANAGER}}/g, config.packageManager);
}