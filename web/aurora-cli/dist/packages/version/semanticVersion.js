export class SemanticVersion {
    static compare(current, required) {
        const currentParts = current
            .split(".")
            .map(Number);
        const requiredParts = required
            .split(".")
            .map(Number);
        const length = Math.max(currentParts.length, requiredParts.length);
        for (let i = 0; i < length; i++) {
            const a = currentParts[i] ?? 0;
            const b = requiredParts[i] ?? 0;
            if (a > b) {
                return 1;
            }
            if (a < b) {
                return -1;
            }
        }
        return 0;
    }
}
//# sourceMappingURL=semanticVersion.js.map