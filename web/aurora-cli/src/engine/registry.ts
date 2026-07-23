import type { ProjectConfig } from "../types/project.js";

const templates: Record<string, string> = {
  nextjs: "nextjs",
  react: "react",
  vue: "vue",
  svelte: "svelte",
};

export function getTemplateDirectory(
  config: ProjectConfig
): string {
  const template = templates[config.framework.toLowerCase()];

  if (!template) {
    throw new Error(
      `Unsupported framework: ${config.framework}`
    );
  }

  return template;
}