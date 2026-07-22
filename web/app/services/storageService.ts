export class StorageService {
  static get<T>(key: string): T | null {
    if (typeof window === "undefined") return null;

    const item = localStorage.getItem(key);

    if (!item) return null;

    return JSON.parse(item) as T;
  }

  static set<T>(key: string, value: T) {
    if (typeof window === "undefined") return;

    localStorage.setItem(
      key,
      JSON.stringify(value)
    );
  }

  static remove(key: string) {
    if (typeof window === "undefined") return;

    localStorage.removeItem(key);
  }

  static clear() {
    if (typeof window === "undefined") return;

    localStorage.clear();
  }
}