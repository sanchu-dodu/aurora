import fs from "fs-extra";
import path from "path";

import { AuroraFeature } from "../feature.js";
import { registerFeature } from "../registry/featureRegistry.js";

const authFeature: AuroraFeature = {

  id: "auth",

  displayName: "Authentication",

  description:
    "Adds NextAuth authentication.",

  version: "1.0.0",

  dependencies: [
    "next-auth"
  ],

  async install(
    projectPath: string
  ): Promise<void> {

    const auroraFolder = path.join(
      projectPath,
      ".aurora"
    );

    await fs.ensureDir(
      auroraFolder
    );

    await fs.writeFile(
      path.join(
        auroraFolder,
        "auth.json"
      ),
      JSON.stringify(
        {
          provider: "next-auth",
          installed: true,
        },
        null,
        2
      )
    );

    console.log(
      "Authentication feature configured."
    );

  }

};

registerFeature(authFeature);