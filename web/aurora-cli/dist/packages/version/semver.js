export class SemVer {
    major;
    minor;
    patch;
    constructor(major, minor, patch) {
        this.major = major;
        this.minor = minor;
        this.patch = patch;
    }
    static parse(version) {
        const parts = version.split(".");
        if (parts.length !== 3) {
            throw new Error(`Invalid version: ${version}`);
        }
        return new SemVer(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
    toString() {
        return `${this.major}.${this.minor}.${this.patch}`;
    }
}
//# sourceMappingURL=semver.js.map