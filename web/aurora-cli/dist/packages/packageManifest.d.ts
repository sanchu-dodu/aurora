export interface PackageManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    author?: string;
    homepage?: string;
    frameworks: string[];
    dependencies: string[];
}
