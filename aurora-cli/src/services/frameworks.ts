import { discoverTemplates } from "./discovery.js";
import { loadTemplateManifest } from "./manifest.js";

export type FrameworkOption = {
  name: string;
  value: string;
  description: string;
};

export async function getAvailableFrameworks(): Promise<FrameworkOption[]> {
  const templates = await discoverTemplates();

  const frameworks: FrameworkOption[] = [];

  for (const template of templates) {
    const manifest = await loadTemplateManifest(template);

    frameworks.push({
      name: manifest.displayName,
      value: manifest.framework,
      description: manifest.description,
    });
  }

  return frameworks;
}

export async function getFrameworkDisplayName(
  framework: string
): Promise<string> {
  const frameworks = await getAvailableFrameworks();

  const match = frameworks.find(
    (item) => item.value === framework
  );

  return match?.name ?? framework;
}