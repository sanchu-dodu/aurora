import { runCommand } from "../services/processService.js";
import { FrameworkAdapter } from "./frameworkAdapter.js";

export class NextJsAdapter
  implements FrameworkAdapter {

  id = "nextjs";

  displayName =
    "Next.js";

  async createProject(
    projectName: string
  ): Promise<void> {

    await runCommand(
      "npx",
      [
        "create-next-app@latest",
        projectName,
        "--typescript",
        "--eslint",
        "--tailwind",
        "--app",
        "--src-dir",
        "--import-alias",
        "@/*",
      ]
    );

  }

}