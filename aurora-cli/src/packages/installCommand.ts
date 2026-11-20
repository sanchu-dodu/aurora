import { PackageInstaller } from "./installer/packageInstaller.js";
import { redactSensitiveValue, redactText } from "../security/secretRedactor.js";

export interface PackageInstallOptions {
  readonly dryRun?: boolean;
  readonly json?: boolean;
}

export async function installPackage(
  packageId: string,
  options: PackageInstallOptions = {}
): Promise<void> {
  if (options.json && !options.dryRun) {
    throw new Error("The --json option for 'package install' requires --dry-run.");
  }
  const installer = new PackageInstaller();
  if (options.dryRun) {
    const preview = await installer.preview(packageId);
    if (options.json) {
      console.log(JSON.stringify(redactSensitiveValue(preview), null, 2));
      return;
    }

    console.log(`Package installation preview: ${preview.requestedPackage}`);
    console.log(`Project: ${redactText(preview.projectRoot)}`);
    for (const { id, version, deprecated } of preview.packages) {
      console.log(`  ${id}@${version}${deprecated ? " (deprecated)" : ""}`);
    }
    preview.batches.forEach((batch, index) => console.log(`Batch ${index + 1}: ${batch.join(", ")}`));
    console.log("Dry run: no package code ran and no files were written.");
    console.log("Installed state is checked during a real install; hook effects are not previewed.");
    return;
  }
  await installer.install(packageId);
}
