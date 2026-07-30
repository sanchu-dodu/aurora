export interface AuroraTemplate {
    id: string;
    name: string;
    displayName: string;
    version: string;
    description: string;
    author: string;
    framework: string;
    path: string;
    tags: string[];
}
export declare function registerTemplate(template: AuroraTemplate): void;
export declare function getTemplates(): AuroraTemplate[];
