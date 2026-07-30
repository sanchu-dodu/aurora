export function createPipelineContext(framework, projectName) {
    return {
        framework,
        projectName,
        projectPath: projectName,
        packageManager: "npm",
        templateId: framework,
        metadata: {},
    };
}
//# sourceMappingURL=pipelineBuilder.js.map