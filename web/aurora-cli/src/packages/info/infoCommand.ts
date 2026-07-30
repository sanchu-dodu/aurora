import { showPackageInfo } from "./packageInfo.js";

export async function packageInfoCommand(
  packageId: string
): Promise<void> {

  await showPackageInfo(packageId);

}