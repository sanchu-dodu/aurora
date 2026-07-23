import { askProjectName } from "../prompts/projectName.js";
import { askFramework } from "../prompts/framework.js";
import { askLanguage } from "../prompts/language.js";

export async function initCommand(): Promise<void> {
  console.clear();

  console.log("=======================================");
  console.log("        Aurora Project Wizard");
  console.log("=======================================");
  console.log("");

  const projectName = await askProjectName();
  const framework = await askFramework();
  const language = await askLanguage();

  console.log("");
  console.log("=======================================");
  console.log("Project Summary");
  console.log("=======================================");
  console.log(`Project Name : ${projectName}`);
  console.log(`Framework    : ${framework}`);
  console.log(`Language     : ${language}`);
  console.log("");
  console.log("Ready for the next step...");
}