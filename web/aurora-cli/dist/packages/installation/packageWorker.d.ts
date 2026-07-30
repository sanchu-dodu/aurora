import { InstallerContext } from "../installer/installerContext.js";
export declare class PackageWorker {
    install(pkg: string, context: InstallerContext): Promise<void>;
}
