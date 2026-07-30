import path from "path";
import { PackagePublisher } from "./packagePublisher.js";
export async function publishPackage(packageId) {
    const publisher = new PackagePublisher();
    await publisher.publish(path.join(process.cwd(), "packages", packageId));
}
//# sourceMappingURL=publishCommand.js.map