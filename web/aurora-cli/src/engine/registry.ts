import type { ProjectConfig } from "../types/project.js";

export function getTemplateDirectory(
  config: ProjectConfig
): string {
  switch (config.framework.toLowerCase()) {
    case "next.js":
      return "nextjs";

    case "react":
      return "react";

    case "vue":
      return "vue";

    case "svelte":
      return "svelte";

    default:
      throw new Error(
        `Unsupported framework: ${config.framework}`
      );
  }
}