import crypto from "crypto";
import fs from "fs/promises";
export class IntegrityChecker {
    async checksum(file) {
        const buffer = await fs.readFile(file);
        return crypto
            .createHash("sha256")
            .update(buffer)
            .digest("hex");
    }
    verify(expected, actual) {
        return expected === actual;
    }
}
//# sourceMappingURL=integrityChecker.js.map