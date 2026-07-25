import { getTemplate } from "../../templates/registry/templateRegistry.js";

export interface GeneratorDefinition {

  id: string;

  output: string;

}

const generators =
  new Map<string, GeneratorDefinition>();

export function registerGenerator(
  id: string
): void {

  const template =
    getTemplate(id);

  generators.set(
    id,
    {
      id,
      output: template.output,
    }
  );

}

export function getGenerator(
  id: string
): GeneratorDefinition {

  const generator =
    generators.get(id);

  if (!generator) {

    throw new Error(
      `Unknown generator: ${id}`
    );

  }

  return generator;

}

export function listGenerators(): GeneratorDefinition[] {

  return [
    ...generators.values()
  ];

}