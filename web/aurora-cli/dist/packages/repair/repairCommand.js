import { RepairManager } from "./repairManager.js";
export async function repairPackage(packageId) {
    const manager = new RepairManager();
    await manager.repair(packageId, process.cwd());
}
//# sourceMappingURL=repairCommand.js.map