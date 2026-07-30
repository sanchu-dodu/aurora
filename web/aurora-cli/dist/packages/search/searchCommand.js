import { PackageRegistry } from "../registry/registry.js";
export async function searchPackages(query) {
    const registry = new PackageRegistry();
    const packages = await registry.getAllPackages();
    const results = packages.filter((pkg) => {
        const text = `${pkg.id} ${pkg.name} ${pkg.description}`
            .toLowerCase();
        return text.includes(query.toLowerCase());
    });
    console.log();
    console.log("Search Results");
    console.log("==============");
    console.log();
    if (results.length === 0) {
        console.log(`No packages matched "${query}".`);
        return;
    }
    for (const pkg of results) {
        console.log(`📦 ${pkg.name}`);
        console.log(`ID: ${pkg.id}`);
        console.log(`Version: ${pkg.version}`);
        console.log(`Description: ${pkg.description}`);
        console.log();
    }
}
//# sourceMappingURL=searchCommand.js.map