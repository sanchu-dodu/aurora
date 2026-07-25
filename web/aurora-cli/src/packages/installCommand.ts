import { PackageInstaller } from "./installer/packageInstaller.js";

export async function installPackage(
  packageId: string
): Promise<void> {

  const installer =
    new PackageInstaller();

  await installer.install(
    packageId
  );

}