interface FeatureManifest {
    installed: string[];
}
export declare function loadManifest(projectPath: string): Promise<FeatureManifest>;
export declare function saveManifest(projectPath: string, manifest: FeatureManifest): Promise<void>;
export declare function isInstalled(projectPath: string, featureId: string): Promise<boolean>;
export declare function addInstalledFeature(projectPath: string, featureId: string): Promise<void>;
export {};
