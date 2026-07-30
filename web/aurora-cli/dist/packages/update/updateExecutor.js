import { PackageWorker } from "../installation/packageWorker.js";
export class UpdateExecutor {
    async execute(packageId, context) {
        const worker = new PackageWorker();
        await worker.install(packageId, context);
    }
}
//# sourceMappingURL=updateExecutor.js.map