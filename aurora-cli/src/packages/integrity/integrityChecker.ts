import crypto from "crypto";
import fs from "fs/promises";

export class IntegrityChecker {

  async checksum(
    file: string
  ): Promise<string> {

    const buffer =
      await fs.readFile(file);

    return crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");

  }

  verify(
    expected: string,
    actual: string
  ): boolean {

    return expected === actual;

  }

}