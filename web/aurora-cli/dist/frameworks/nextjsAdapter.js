import { runCommand } from "../services/processService.js";
export class NextJsAdapter {
    id = "nextjs";
    displayName = "Next.js";
    async createProject(projectName) {
        await runCommand("npx", [
            "create-next-app@latest",
            projectName,
            "--typescript",
            "--eslint",
            "--tailwind",
            "--app",
            "--src-dir",
            "--import-alias",
            "@/*",
        ]);
    }
}
//# sourceMappingURL=nextjsAdapter.js.map