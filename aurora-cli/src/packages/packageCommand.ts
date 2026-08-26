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
import { proposeOfficialRegistryRelease } from "./registry/officialRegistryReleaseCommand.js";

export async function packageListCommand(): Promise<void> {

  await listPackagesCommand();

}

export async function packageTestManifestCommand(): Promise<void> {

  await testManifest();

}

export async function packageResolveCommand(
  packageId: string
): Promise<void> {

  await testResolver(
    packageId
  );

}

export async function packageInstallCommand(
  packageId: string
): Promise<void> {

  await installPackage(
    packageId
  );

}

export async function packageUpdateCommand(
  packageId: string
): Promise<void> {

  await updatePackage(
    packageId
  );

}

export async function packageSearchCommand(
  query: string
): Promise<void> {

  await searchPackages(
    query
  );

}

export async function packageInfoCommand(
  packageId: string
): Promise<void> {

  await showPackageInfo(
    packageId
  );

}

export async function packageUninstallCommand(
  packageId: string
): Promise<void> {

  await uninstallPackage(
    packageId
  );

}

export async function packageVerifyCommand(
  packageId: string
): Promise<void> {

  await verifyPackage(
    packageId
  );

}

export async function packageRepairCommand(
  packageId: string
): Promise<void> {

  await repairPackage(
    packageId
  );

}

export async function packageTreeCommand(
  packageId: string
): Promise<void> {

  await showDependencyTree(
    packageId
  );

}

export async function packagePublishCommand(
  packageId: string,
  options: {
    readonly dryRun?: boolean;
  } = {}
): Promise<void> {

  await publishPackage(
    packageId,
    options
  );

}

export async function packageProposeReleaseCommand(
  packageId: string,
  options: {
    readonly registryHistory:
      string;
    readonly archiveUrl:
      string;
    readonly publishedAt:
      string;
    readonly dryRun?:
      boolean;
  }
): Promise<void> {

  await proposeOfficialRegistryRelease(
    packageId,
    options
  );

}
