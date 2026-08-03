import { fileURLToPath } from "node:url";

export function getDefaultGeneratorTemplateRoot():
  string {
  return fileURLToPath(
    new URL(
      "../../templates/generators/",
      import.meta.url
    )
  );
}
