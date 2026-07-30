import { InstallerContext } from "../installer/installerContext.js";
export declare class UpdateExecutor {
    execute(packageId: string, context: InstallerContext): Promise<void>;
}
