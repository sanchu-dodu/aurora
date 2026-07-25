import { listTemplates } from "../../templates/registry/templateRegistry.js";

import { registerGenerator } from "./generatorRegistry.js";

export function registerAllGenerators(): void {

  const templates =
    listTemplates();

  for (const template of templates) {

    registerGenerator(
      template.id
    );

  }

}