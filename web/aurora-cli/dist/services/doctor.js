import { exec } from "child_process";
import { logger } from "../core/logger.js";
function check(command) {
    return new Promise((resolve) => {
        exec(command, (error) => {
            resolve(!error);
        });
    });
}
export async function runDoctor() {
    console.log("");
    logger.title("Aurora Doctor");
    console.log("========================");
    const checks = [
        {
            name: "Git",
            command: "git --version",
        },
        {
            name: "Node.js",
            command: "node --version",
        },
        {
            name: "npm",
            command: "npm --version",
        },
    ];
    for (const checkItem of checks) {
        const ok = await check(checkItem.command);
        console.log(`${ok ? "✅" : "❌"} ${checkItem.name}`);
    }
    console.log("");
}
//# sourceMappingURL=doctor.js.map