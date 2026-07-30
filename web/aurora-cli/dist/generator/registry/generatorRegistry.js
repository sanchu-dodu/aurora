import { getTemplate } from "../../templates/registry/templateRegistry.js";
const generators = new Map();
export function registerGenerator(id) {
    const template = getTemplate(id);
    generators.set(id, {
        id,
        output: template.output,
    });
}
export function getGenerator(id) {
    const generator = generators.get(id);
    if (!generator) {
        throw new Error(`Unknown generator: ${id}`);
    }
    return generator;
}
export function listGenerators() {
    return [
        ...generators.values()
    ];
}
//# sourceMappingURL=generatorRegistry.js.map