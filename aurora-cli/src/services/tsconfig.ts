import fs from "fs-extra";
import path from "path";

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

  await fs.writeJson(
    path.join(projectPath, "tsconfig.json"),
    tsconfig,
    {
      spaces: 2,
    }
  );
}