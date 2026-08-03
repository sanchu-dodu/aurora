import type {
  AuroraFeature,
} from "../feature.js";

import {
  registerFeature,
} from "../registry/featureRegistry.js";

const authFeature: AuroraFeature = {
  id: "auth",

  displayName: "Authentication",

  description:
    "Adds NextAuth authentication.",

  version: "1.0.0",

  dependencies: [
    "next-auth",
  ],

  async install(
    context
  ): Promise<void> {
    await context.writeJson(
      ".aurora/auth.json",
      {
        provider: "next-auth",
        installed: true,
      }
    );

    console.log(
      "Authentication feature configured."
    );
  },
};

registerFeature(authFeature);
