import { spawn } from "child_process";

export async function installDependencies(
  projectPath: string,
  packageManager: string
): Promise<void> {
  const commands: Record<string, [string, string[]]> = {
  npm: ["npm", ["install"]],
  pnpm: ["pnpm", ["install"]],
  yarn: ["yarn", []],
  bun: ["bun", ["install"]],
};

const command = commands[packageManager];

if (!command) {
  throw new Error(
    `Unsupported package manager: ${packageManager}`
  );
}

const [executable, args] = command;

await new Promise<void>((resolve, reject) => {
  const child = spawn(executable, args, {
    cwd: projectPath,
    stdio: "inherit",
    shell: true,
  });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Dependency installation failed."));
    });
  });
}