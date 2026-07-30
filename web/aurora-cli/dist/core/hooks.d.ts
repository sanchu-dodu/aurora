type Hook = () => Promise<void> | void;
declare class HookManager {
    private hooks;
    register(name: string, hook: Hook): void;
    execute(name: string): Promise<void>;
}
export declare const hookManager: HookManager;
export {};
