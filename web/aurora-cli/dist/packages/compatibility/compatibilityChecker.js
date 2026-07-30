import { SemanticVersion } from "../version/semanticVersion.js";
export class CompatibilityChecker {
    check(manifest) {
        console.log(`Checking compatibility for ${manifest.id}...`);
        if (!manifest.version) {
            throw new Error(`${manifest.id} has no version.`);
        }
        const minimumVersion = "1.0.0";
        const result = SemanticVersion.compare(manifest.version, minimumVersion);
        if (result < 0) {
            throw new Error(`${manifest.id} requires version ${minimumVersion} or newer. Current version: ${manifest.version}`);
        }
        console.log(`Compatibility OK (${manifest.version})`);
    }
}
//# sourceMappingURL=compatibilityChecker.js.map