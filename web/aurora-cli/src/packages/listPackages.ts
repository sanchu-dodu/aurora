import { listPackages } from "./registry/packageRegistry.js";

export async function listPackagesCommand(): Promise<void> {

  console.log();

  console.log("Available Packages");

  console.log("==================");

  console.log();

  for (const pkg of listPackages()) {

    console.log(`📦 ${pkg.name}`);

    console.log(`ID: ${pkg.id}`);

    console.log(`Version: ${pkg.version}`);

    console.log(`Description: ${pkg.description}`);

    console.log();

  }

}