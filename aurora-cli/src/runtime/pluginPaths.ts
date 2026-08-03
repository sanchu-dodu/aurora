import { fileURLToPath } from "node:url";

export function getDefaultPluginRoot(): string {
  return fileURLToPath(
    new URL(
      "../plugins/",
      import.meta.url
    )
  );
}
