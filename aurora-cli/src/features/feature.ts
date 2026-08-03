import type {
  FeatureInstallContext,
} from "./installers/featureInstallContext.js";

export interface AuroraFeature {
  id: string;

  displayName: string;

  description: string;

  version: string;

  dependencies: string[];

  install(
    context: FeatureInstallContext
  ): Promise<void>;
}
