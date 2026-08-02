import { PackageRegistry } from "./registry/registry.js";

export async function listPackagesCommand(): Promise<void> {

  const registry =
    new PackageRegistry();

  const packages =
    await registry.getAllPackages();

  console.log();

  console.log("Available Packages");

  console.log("==================");

  console.log();

  for (const pkg of packages) {

    console.log(`📦 ${pkg.name}`);
    console.log(`ID: ${pkg.id}`);
    console.log(`Version: ${pkg.version}`);
    console.log(`Description: ${pkg.description}`);
    console.log();

  }

}