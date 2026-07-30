import { UpdateManager } from "./update/updateManager.js";
export async function updatePackage(packageId) {
    const manager = new UpdateManager();
    const result = await manager.check(packageId, process.cwd());
    console.log();
    console.log("Update Check");
    console.log("============");
    console.log(`Package: ${result.package}`);
    console.log(`Current Version: ${result.currentVersion}`);
    console.log(`Latest Version: ${result.latestVersion}`);
    if (result.updateAvailable) {
        console.log();
        console.log("Update Plan");
        console.log("===========");
        for (const step of result.plan) {
            console.log(`${step.package}: ${step.currentVersion} → ${step.targetVersion}`);
        }
        console.log();
        console.log(`Backup created: ${result.backup}`);
    }
    else {
        console.log();
        console.log("Already up to date.");
    }
    console.log();
}
//# sourceMappingURL=updateCommand.js.map