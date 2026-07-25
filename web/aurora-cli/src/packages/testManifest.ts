import path from "path";

import { loadManifest } from "./manifestLoader.js";

export async function testManifest(): Promise<void> {

  const manifest =
    await loadManifest(

      path.join(
        process.cwd(),
        "packages",
        "auth",
        "manifest.json"
      )

    );

  console.log();

  console.log("Loaded Manifest");

  console.log("================");

  console.log(manifest);

}