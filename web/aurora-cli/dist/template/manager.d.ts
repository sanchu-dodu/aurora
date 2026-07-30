export declare function getTemplates(): Promise<{
    id: string;
    name: string;
    description: string;
    manifest: import("../types/template.js").TemplateManifest;
}[]>;
