import { listGenerators } from "./registry/generatorRegistry.js";

export async function listGeneratorCommand(): Promise<void> {

  console.log();

  console.log("Available Generators");

  console.log("====================");

  console.log();

  for (const generator of listGenerators()) {

    console.log(`📦 ${generator.id}`);

    console.log(
      `Output: ${generator.output}`
    );

    console.log();

  }

}