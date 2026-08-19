import {
  InstalledStateVerifier,
} from "./installedStateVerifier.js";

export class VerifyManager {
  async verify(
    packageId: string,
    projectPath: string
  ): Promise<void> {
    const verifier =
      new InstalledStateVerifier();

    await verifier.verify(
      packageId,
      projectPath
    );

    console.log();
    console.log(
      "Package Verification"
    );
    console.log(
      "===================="
    );
    console.log();

    console.log(
      `Package: ${packageId}`
    );
    console.log();

    console.log(
      "Package verified successfully."
    );

    console.log();
  }
}
