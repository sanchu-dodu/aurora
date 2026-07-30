import { Command } from "commander";
export interface AuroraCommand {
    register(program: Command): void;
}
export declare function registerCommand(command: AuroraCommand): void;
export declare function registerAllCommands(program: Command): void;
