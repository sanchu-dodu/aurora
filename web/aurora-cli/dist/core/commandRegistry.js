const registry = [];
export function registerCommand(command) {
    registry.push(command);
}
export function registerAllCommands(program) {
    for (const command of registry) {
        command.register(program);
    }
}
//# sourceMappingURL=commandRegistry.js.map