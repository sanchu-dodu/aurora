import { PackageRegistry } from "../registry/packageRegistry.js";
import { runInstallation } from "../installation/installationScheduler.js";
import { InstallationContext } from "./installationContext.js";
export class PackageInstallationService {

  private registry = new PackageRegistry();

  async install(
    packageId: string
  ): Promise<void> {

    console.log("");

    console.log(
      `Installing ${packageId}...`
    );

    const pkg =
      this.registry.getPackage(
        packageId
      );

    console.log(`Found package: ${pkg.name}`);
console.log(`Version: ${pkg.version}`);
console.log("✔ Package located.");

const context = new InstallationContext(
    process.cwd(),
    pkg,
    "npm"
);

await runInstallation(context);

console.log("");
console.log("✔ Installation completed.");
  }

}