import { spawn } from "node:child_process";


export async function runCommand(
  command: string,
  args: string[],
  cwd?: string
): Promise<void> {

  return new Promise((resolve, reject) => {

    let executable = command;
    let finalArgs = args;


    if (process.platform === "win32") {

      if (
        command === "npx" ||
        command === "npm"
      ) {

        executable = "cmd";

        finalArgs = [
          "/c",
          command,
          ...args,
        ];

      }

    }


    const child = spawn(
      executable,
      finalArgs,
      {
        cwd,
        stdio: "inherit",
      }
    );


    child.on(
      "error",
      error => {
        reject(error);
      }
    );


    child.on(
      "close",
      code => {

        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `Command exited with code ${code}`
            )
          );
        }

      }
    );

  });

}