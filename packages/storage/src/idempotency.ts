import type { IdempotencyStore } from "@sevana/connectors";
import type { BlobStorageAdapter } from "./adapter.js";

interface Record {
  state: "reserved" | "committed";
  expiresAt: number;
}

/**
 * Blob-backed idempotency store. Survives serverless cold starts, unlike the
 * in-memory default in @sevana/connectors/webhooks.
 *
 * IMPORTANT: Blob is an object store, not a transactional KV. `tryReserve`'s
 * check-and-set is best-effort — two concurrent webhook deliveries arriving
 * within the same millisecond may both succeed. For a Phase-1 pilot this is
 * acceptable (the receiver's idempotency is one defence among several); for
 * higher throughput swap this for Vercel KV / Upstash Redis which have
 * proper atomic SETNX semantics.
 */
export class BlobIdempotencyStore implements IdempotencyStore {
  private readonly adapter: BlobStorageAdapter;
  private readonly prefix: string;
  private readonly clock: () => number;
  private readonly defaultTtlMs: number;

  constructor(opts: {
    adapter: BlobStorageAdapter;
    prefix?: string;
    clock?: () => number;
    defaultTtlMs?: number;
  }) {
    this.adapter = opts.adapter;
    this.prefix = opts.prefix ?? "idempotency";
    this.clock = opts.clock ?? Date.now;
    this.defaultTtlMs = opts.defaultTtlMs ?? 24 * 60 * 60 * 1000;
  }

  private pathname(key: string): string {
    return `${this.prefix}/${encodeURIComponent(key)}.json`;
  }

  async tryReserve(key: string, ttlMs?: number): Promise<boolean> {
    const path = this.pathname(key);
    const now = this.clock();
    const existing = await this.adapter.get(path);
    if (existing) {
      const data = JSON.parse(existing) as Record;
      if (data.expiresAt > now) return false;
    }
    const record: Record = {
      state: "reserved",
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
    };
    await this.adapter.put(path, JSON.stringify(record));
    return true;
  }

  async commit(key: string, ttlMs?: number): Promise<void> {
    const path = this.pathname(key);
    const now = this.clock();
    const record: Record = {
      state: "committed",
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
    };
    await this.adapter.put(path, JSON.stringify(record));
  }

  async release(key: string): Promise<void> {
    await this.adapter.delete(this.pathname(key));
  }
}
