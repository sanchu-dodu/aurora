import { fileURLToPath } from "node:url";

export function getDefaultPackageRoot(): string {
  return fileURLToPath(
    new URL(
      "../../packages/",
      import.meta.url
    )
  );
}
