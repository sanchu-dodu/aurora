import { AuroraConfig } from "./defaults.js";
export declare function loadConfig(): Promise<AuroraConfig>;
export declare function saveConfig(config: AuroraConfig): Promise<void>;
