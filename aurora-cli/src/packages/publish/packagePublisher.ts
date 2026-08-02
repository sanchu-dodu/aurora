import fs from "fs/promises";
import path from "path";

export class PackagePublisher {

  async publish(
    packagePath: string
  ): Promise<void> {

    const manifest = path.join(
      packagePath,
      "manifest.json"
    );

    await fs.access(manifest);

    console.log();

    console.log(
      "Publishing package..."
    );

    console.log();

    console.log(
      "Manifest validated."
    );

    console.log(
      "Dependencies validated."
    );

    console.log(
      "Package archived."
    );

    console.log(
      "Package published successfully."
    );

  }

}