export interface AuroraTemplate {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  framework: string;
  path: string;
  tags: string[];
}

const templates: AuroraTemplate[] = [];

export function registerTemplate(
  template: AuroraTemplate
): void {
  templates.push(template);
}

export function getTemplates(): AuroraTemplate[] {
  return templates;
}