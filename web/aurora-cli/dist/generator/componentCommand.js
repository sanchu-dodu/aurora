import { ComponentGenerator } from "./componentGenerator.js";
export async function generateComponent(project, name) {
    const generator = new ComponentGenerator();
    await generator.generate(project, name);
    console.log("");
    console.log("Component generated.");
}
//# sourceMappingURL=componentCommand.js.map