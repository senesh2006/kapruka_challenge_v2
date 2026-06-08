/**
 * Persists the session id across page loads so a customer can refresh and
 * continue the same conversation. Uses sessionStorage in the browser; tests
 * inject the in-memory variant.
 */
export interface SessionStore {
  get(): string | null;
  set(sessionId: string): void;
  clear(): void;
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
