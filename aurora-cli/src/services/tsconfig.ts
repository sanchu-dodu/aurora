import fs from "fs-extra";

import {
  ProjectPathBoundary,
} from "../security/projectPathBoundary.js";

export async function createTsConfig(
  projectPath: string
): Promise<void> {
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Node",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ["src"],
  };

  const pathBoundary =
    new ProjectPathBoundary(
      projectPath
    );

  await fs.writeJson(
    pathBoundary.resolve(
      "tsconfig.json"
    ),
    tsconfig,
    {
      spaces: 2,
    }
  );
}
