import type { AuroraPackage } from "../packageMetadata.js";

export class InstallationContext {

  constructor(
    public readonly projectPath: string,
    public readonly packageData: AuroraPackage,
    public readonly packageManager: string
  ) {}

  /**
   * Dependencies discovered during installation.
   */
  resolvedDependencies: string[] = [];

  /**
   * Final installation order.
   */
  installationOrder: string[] = [];

  /**
   * Installed packages.
   */
  installedDependencies: string[] = [];

  /**
   * Files copied.
   */
  copiedFiles: string[] = [];

  /**
   * Shared runtime state.
   */
  state = new Map<string, unknown>();

  /**
   * Arbitrary metadata.
   */
  metadata = new Map<string, unknown>();

}