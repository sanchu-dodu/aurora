import { resolveDependencies } from "./dependencyResolver.js";
export async function testResolver(packageId) {
    const packages = await resolveDependencies(packageId);
    console.log();
    console.log("Installation Order");
    console.log("==================");
    for (const pkg of packages) {
        console.log(pkg);
    }
}
//# sourceMappingURL=testResolver.js.map