export declare class WriteLock {
    private static locked;
    acquire(): Promise<void>;
    release(): void;
}
