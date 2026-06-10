/**
 * Persists the session id across page loads so a customer can refresh and
 * continue the same conversation. The interface tolerates both sync stores
 * (browser sessionStorage) and async ones (React Native AsyncStorage) — the
 * `ChannelClient` awaits whatever they return.
 */
export interface SessionStore {
  get(): string | null | Promise<string | null>;
  set(sessionId: string): void | Promise<void>;
  clear(): void | Promise<void>;
}

const KEY = "sevana.sessionId";

export class BrowserSessionStore implements SessionStore {
  private readonly storageKey: string;

  constructor(opts: { storageKey?: string } = {}) {
    this.storageKey = opts.storageKey ?? KEY;
  }

  get(): string | null {
    if (typeof window === "undefined") return null;
    try {
      return window.sessionStorage.getItem(this.storageKey);
    } catch {
      return null;
    }
  }

  set(sessionId: string): void {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(this.storageKey, sessionId);
    } catch {
      /* sessionStorage may be unavailable in some embed contexts */
    }
  }

  clear(): void {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(this.storageKey);
    } catch {
      /* noop */
    }
  }
}

export class InMemorySessionStore implements SessionStore {
  private value: string | null = null;
  get(): string | null {
    return this.value;
  }
  set(sessionId: string): void {
    this.value = sessionId;
  }
  clear(): void {
    this.value = null;
  }
}

/**
 * Minimal contract the React Native `@react-native-async-storage/async-storage`
 * module satisfies — `getItem` / `setItem` / `removeItem`. Anything that
 * matches plugs in here (UniStorage, MMKV with an adapter, plain in-memory
 * test doubles).
 */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * SessionStore backed by an AsyncStorage-shaped backend. Used by the mobile
 * SDK channel adapter (PRD §9 / 8.2) so a customer can come back to the app
 * and continue the same Sevana conversation.
 */
export class AsyncStorageSessionStore implements SessionStore {
  private readonly storageKey: string;
  private readonly storage: AsyncStorageLike;

  constructor(storage: AsyncStorageLike, opts: { storageKey?: string } = {}) {
    this.storage = storage;
    this.storageKey = opts.storageKey ?? KEY;
  }

  async get(): Promise<string | null> {
    try {
      return await this.storage.getItem(this.storageKey);
    } catch {
      return null;
    }
  }

  async set(sessionId: string): Promise<void> {
    try {
      await this.storage.setItem(this.storageKey, sessionId);
    } catch {
      /* noop — best-effort */
    }
  }

  async clear(): Promise<void> {
    try {
      await this.storage.removeItem(this.storageKey);
    } catch {
      /* noop */
    }
  }
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Short, URL-safe random id. Not cryptographically strong — just unique enough for client-side session ids. */
export function newSessionId(): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
      ? Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map((n) => ID_ALPHABET[n % ID_ALPHABET.length])
          .join("")
      : Math.random().toString(36).slice(2, 10);
  return `s-${Date.now().toString(36)}-${rand}`;
}
