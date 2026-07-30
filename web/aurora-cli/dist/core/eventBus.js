class EventBus {
    handlers = new Map();
    on(event, handler) {
        const list = this.handlers.get(event) ?? [];
        list.push(handler);
        this.handlers.set(event, list);
    }
    async emit(event, payload) {
        const handlers = this.handlers.get(event);
        if (!handlers)
            return;
        for (const handler of handlers) {
            await handler(payload);
        }
    }
}
export const eventBus = new EventBus();
import { container } from "./serviceContainer.js";
container.register("eventBus", eventBus);
//# sourceMappingURL=eventBus.js.map