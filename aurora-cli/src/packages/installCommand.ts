import { PackageInstallationService }
from "./installer/packageInstallationService.js";

export async function installPackage(
  packageId: string
): Promise<void> {

  const installer =
    new PackageInstallationService();

  await installer.install(
    packageId
  );

}