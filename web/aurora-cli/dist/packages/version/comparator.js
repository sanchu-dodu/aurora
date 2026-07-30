export class VersionComparator {
    compare(a, b) {
        if (a.major !== b.major) {
            return a.major - b.major;
        }
        if (a.minor !== b.minor) {
            return a.minor - b.minor;
        }
        return a.patch - b.patch;
    }
}
//# sourceMappingURL=comparator.js.map