import { listPackagesCommand } from "./listPackages.js";
import { testManifest } from "./testManifest.js";
import { testResolver } from "./testResolver.js";
import { installPackage } from "./installCommand.js";
import { updatePackage } from "./updateCommand.js";
import { searchPackages } from "./search/searchCommand.js";
import { packageInfoCommand as showPackageInfo } from "./info/infoCommand.js";
import { uninstallPackage } from "./uninstall/uninstallCommand.js";
import { verifyPackage } from "./verify/verifyCommand.js";
import { repairPackage } from "./repair/repairCommand.js";
import { showDependencyTree } from "./tree/treeCommand.js";
import { publishPackage } from "./publish/publishCommand.js";
export async function packageListCommand() {
    await listPackagesCommand();
}
export async function packageTestManifestCommand() {
    await testManifest();
}
export async function packageResolveCommand(packageId) {
    await testResolver(packageId);
}
export async function packageInstallCommand(packageId) {
    await installPackage(packageId);
}
export async function packageUpdateCommand(packageId) {
    await updatePackage(packageId);
}
export async function packageSearchCommand(query) {
    await searchPackages(query);
}
export async function packageInfoCommand(packageId) {
    await showPackageInfo(packageId);
}
export async function packageUninstallCommand(packageId) {
    await uninstallPackage(packageId);
}
export async function packageVerifyCommand(packageId) {
    await verifyPackage(packageId);
}
export async function packageRepairCommand(packageId) {
    await repairPackage(packageId);
}
export async function packageTreeCommand(packageId) {
    await showDependencyTree(packageId);
}
export async function packagePublishCommand(packageId) {
    await publishPackage(packageId);
}
//# sourceMappingURL=packageCommand.js.map