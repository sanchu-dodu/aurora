import type { AuroraPackage } from "../packageMetadata.js";

export class InstallationContext {

  constructor(

    public readonly projectPath: string,

    public readonly packageData: AuroraPackage,

    public readonly packageManager: string

  ) {}

  installedDependencies: string[] = [];

  copiedFiles: string[] = [];

}