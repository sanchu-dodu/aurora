import { VerifyManager } from "./verifyManager.js";

export async function verifyPackage(
  packageId: string
): Promise<void> {

  const manager =
    new VerifyManager();

  await manager.verify(
    packageId,
    process.cwd()
  );

}