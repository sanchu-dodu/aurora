import { spawn } from "child_process";
async function runGit(args, cwd) {
    await new Promise((resolve, reject) => {
        const child = spawn("git", args, {
            cwd,
            stdio: "inherit",
        });
        child.on("close", (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error("Git command failed."));
        });
    });
}
export async function initializeGit(projectPath) {
    await runGit(["init"], projectPath);
    await runGit(["add", "."], projectPath);
    await runGit(["commit", "-m", "Initial commit"], projectPath);
}
//# sourceMappingURL=git.js.map