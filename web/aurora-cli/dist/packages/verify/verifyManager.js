import { CacheManager } from "../cache/cacheManager.js";
import { IntegrityChecker } from "../integrity/integrityChecker.js";
export class VerifyManager {
    async verify(packageId, projectPath) {
        const cache = new CacheManager(projectPath);
        const installed = await cache.read();
        const record = installed[packageId];
        if (!record) {
            throw new Error(`${packageId} is not installed.`);
        }
        const checker = new IntegrityChecker();
        const checksum = await checker.checksum(`${projectPath}/package.json`);
        console.log();
        console.log("Package Verification");
        console.log("====================");
        console.log();
        console.log(`Package: ${packageId}`);
        console.log();
        console.log(`Stored checksum:\n${record.checksum}`);
        console.log();
        console.log(`Current checksum:\n${checksum}`);
        console.log();
        if (checksum === record.checksum) {
            console.log("✔ Package verified successfully.");
        }
        else {
            console.log("✖ Package integrity failed.");
        }
        console.log();
    }
}
//# sourceMappingURL=verifyManager.js.map