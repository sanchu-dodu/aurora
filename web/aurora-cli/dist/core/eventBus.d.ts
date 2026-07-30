type EventHandler = (payload?: unknown) => void | Promise<void>;
declare class EventBus {
    private handlers;
    on(event: string, handler: EventHandler): void;
    emit(event: string, payload?: unknown): Promise<void>;
}
export declare const eventBus: EventBus;
export {};
