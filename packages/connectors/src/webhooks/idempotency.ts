import type { Clock } from "../kapruka/clock.js";
import { wallClock } from "../kapruka/clock.js";

/**
 * Two-phase idempotency: reserve the key (atomic), then either commit (persist
 * as processed) or release (rollback so a retry can re-process). This lets us
 * avoid the lost-event hazard where a bus-publish failure would otherwise leave
 * a duplicate marker in place and silently drop the event.
 */
export interface IdempotencyStore {
  tryReserve(key: string, ttlMs?: number): Promise<boolean>;
  commit(key: string, ttlMs?: number): Promise<void>;
  release(key: string): Promise<void>;
}

interface Entry {
  state: "reserved" | "committed";
  expiresAt: number;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  private readonly clock: Clock;
  private readonly defaultTtlMs: number;

  constructor(opts: { clock?: Clock; defaultTtlMs?: number } = {}) {
    this.clock = opts.clock ?? wallClock;
    this.defaultTtlMs = opts.defaultTtlMs ?? 24 * 60 * 60 * 1000;
  }

  async tryReserve(key: string, ttlMs?: number): Promise<boolean> {
    const now = this.clock.now();
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) return false;
    this.entries.set(key, { state: "reserved", expiresAt: now + (ttlMs ?? this.defaultTtlMs) });
    return true;
  }

  async commit(key: string, ttlMs?: number): Promise<void> {
    const now = this.clock.now();
    this.entries.set(key, { state: "committed", expiresAt: now + (ttlMs ?? this.defaultTtlMs) });
  }

  async release(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
