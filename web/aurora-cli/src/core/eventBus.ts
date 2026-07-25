type EventHandler = (payload?: unknown) => void | Promise<void>;

class EventBus {
  private handlers = new Map<string, EventHandler[]>();

  on(event: string, handler: EventHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  async emit(
    event: string,
    payload?: unknown
  ): Promise<void> {
    const handlers = this.handlers.get(event);

    if (!handlers) return;

    for (const handler of handlers) {
      await handler(payload);
    }
  }
}

export const eventBus = new EventBus();
import { container } from "./serviceContainer.js";

container.register("eventBus", eventBus);