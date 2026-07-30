import { RepairManager } from "./repairManager.js";

export async function repairPackage(
  packageId: string
): Promise<void> {

  const manager =
    new RepairManager();

  await manager.repair(
    packageId,
    process.cwd()
  );

}