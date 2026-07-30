import type { AuroraPackage } from "../packageMetadata.js";

const packages = new Map<string, AuroraPackage>();

export function registerPackage(
  pkg: AuroraPackage
): void {
  packages.set(pkg.id, pkg);
}

export function getPackage(
  id: string
): AuroraPackage {

  const pkg = packages.get(id);

  if (!pkg) {
    throw new Error(`Unknown package: ${id}`);
  }

  return pkg;
}

export function listPackages(): AuroraPackage[] {
  return [...packages.values()];
}

export class PackageRegistry {

  getPackage(id: string): AuroraPackage {
    return getPackage(id);
  }

  getAllPackages(): AuroraPackage[] {
    return listPackages();
  }

}