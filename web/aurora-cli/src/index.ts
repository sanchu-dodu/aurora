import { Command } from "commander";
import { showBanner } from "./utils/banner.js";

const program = new Command();

program
  .name("aurora")
  .description("Aurora Command Line Interface")
  .version("0.1.0");

program.action(() => {
  showBanner();
  console.log("✅ Aurora CLI started successfully.");
});

program.parse(process.argv);