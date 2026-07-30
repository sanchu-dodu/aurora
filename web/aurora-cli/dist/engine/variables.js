export function replaceVariables(content, config) {
    return content
        .replace(/{{projectName}}/g, config.projectName)
        .replace(/PROJECT_NAME_PLACEHOLDER/g, config.projectName)
        .replace(/{{FRAMEWORK}}/g, config.framework)
        .replace(/{{LANGUAGE}}/g, config.language)
        .replace(/{{PACKAGE_MANAGER}}/g, config.packageManager);
}
//# sourceMappingURL=variables.js.map