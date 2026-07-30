const templates = {
    nextjs: "nextjs",
    react: "react",
    vue: "vue",
    svelte: "svelte",
};
export function getTemplateDirectory(config) {
    const template = templates[config.framework.toLowerCase()];
    if (!template) {
        throw new Error(`Unsupported framework: ${config.framework}`);
    }
    return template;
}
//# sourceMappingURL=registry.js.map