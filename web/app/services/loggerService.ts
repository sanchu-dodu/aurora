export class LoggerService {
  static info(message: string, data?: unknown) {
    console.log(
      `%c[AURORA] ${message}`,
      "color:#3b82f6;font-weight:bold;",
      data ?? ""
    );
  }

  static warn(message: string, data?: unknown) {
    console.warn(
      `%c[AURORA WARNING] ${message}`,
      "color:#f59e0b;font-weight:bold;",
      data ?? ""
    );
  }

  static error(message: string, error?: unknown) {
    console.error(
      `%c[AURORA ERROR] ${message}`,
      "color:#ef4444;font-weight:bold;",
      error ?? ""
    );
  }
}