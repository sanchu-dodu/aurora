import { TemplateMetadata } from "../templateMetadata.js";
export declare function discoverTemplates(): Promise<void>;
export declare function getTemplate(id: string): TemplateMetadata;
export declare function listTemplates(): TemplateMetadata[];
