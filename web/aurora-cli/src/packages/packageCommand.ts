import { listPackages } from "./registry/packageRegistry.js";
import { testManifest } from "./testManifest.js";
import { testResolver } from "./testResolver.js";
import { installPackage } from "./installCommand.js";

export async function packageListCommand(): Promise<void> {

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

export async function packageTestManifestCommand(): Promise<void> {

  await testManifest();

}

export async function packageResolveCommand(
  packageId: string
): Promise<void> {

  await testResolver(packageId);

}
export async function packageInstallCommand(
  packageId: string
): Promise<void> {

  await installPackage(
    packageId
  );

}