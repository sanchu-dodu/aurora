import type { AuroraTemplate } from "../core/templateRegistry.js";
export declare function getAllTemplates(): Promise<AuroraTemplate[]>;
export declare function getTemplateById(id: string): Promise<AuroraTemplate | undefined>;
export declare function searchTemplates(query: string): Promise<AuroraTemplate[]>;
export declare function installTemplate(id: string): Promise<AuroraTemplate | undefined>;
