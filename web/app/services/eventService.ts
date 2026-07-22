type EventHandler<T = unknown> = (payload: T) => void;

export class EventService {
  private static listeners = new Map<
    string,
    EventHandler[]
  >();

  static on<T>(
    event: string,
    handler: EventHandler<T>
  ) {
    const handlers =
      this.listeners.get(event) ?? [];

    handlers.push(handler as EventHandler);

    this.listeners.set(event, handlers);
  }

  static emit<T>(
    event: string,
    payload: T
  ) {
    const handlers =
      this.listeners.get(event);

    if (!handlers) return;

    handlers.forEach((handler) =>
      handler(payload)
    );
  }

  static off(
    event: string,
    handler: EventHandler
  ) {
    const handlers =
      this.listeners.get(event);

    if (!handlers) return;

    this.listeners.set(
      event,
      handlers.filter((h) => h !== handler)
    );
  }
}