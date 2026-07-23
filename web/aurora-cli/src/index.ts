import { Command } from "commander";
import { showBanner } from "./utils/banner.js";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("aurora")
  .description("Aurora Command Line Interface")
  .version("0.1.0");

program.action(() => {
  showBanner();
  console.log("✅ Aurora CLI started successfully.");
});

program
  .command("init")
  .description("Initialize a new Aurora project")
  .action(async () => {
    await initCommand();
  });

program.parse(process.argv);