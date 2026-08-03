import path from "node:path";
import { fileURLToPath } from "node:url";

export function getDefaultProjectTemplateRoot():
  string {
  return fileURLToPath(
    new URL(
      "../../templates/projects/",
      import.meta.url
    )
  );
}

export function resolvePathWithinRoot(
  root: string,
  ...segments: string[]
): string {
  const resolvedRoot =
    path.resolve(root);

  const candidate =
    path.resolve(
      resolvedRoot,
      ...segments
    );

  const relative =
    path.relative(
      resolvedRoot,
      candidate
    );

  const escapesRoot =
    relative === ".." ||
    relative.startsWith(
      `..${path.sep}`
    ) ||
    path.isAbsolute(relative);

  if (escapesRoot) {
    throw new Error(
      `Resolved path escapes its allowed root: ${candidate}`
    );
  }

  return candidate;
}
