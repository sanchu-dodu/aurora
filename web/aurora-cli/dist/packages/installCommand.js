import { PackageInstaller } from "./installer/packageInstaller.js";
export async function installPackage(packageId) {
    const installer = new PackageInstaller();
    await installer.install(packageId);
}
//# sourceMappingURL=installCommand.js.map