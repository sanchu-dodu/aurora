import { spawn } from "child_process";

async function runGit(
  args: string[],
  cwd: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
   const child = spawn("git", args, {
  cwd,
  stdio: "inherit",
});
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Git command failed."));
    });
  });
}

export async function initializeGit(
  projectPath: string
): Promise<void> {
  await runGit(["init"], projectPath);
  await runGit(["add", "."], projectPath);
  await runGit(
    ["commit", "-m", "Initial commit"],
    projectPath
  );
}