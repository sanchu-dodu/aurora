import { VerifyManager } from "./verifyManager.js";
export async function verifyPackage(packageId) {
    const manager = new VerifyManager();
    await manager.verify(packageId, process.cwd());
}
//# sourceMappingURL=verifyCommand.js.map