/**
 * Storage adapter — abstracts the underlying object store so the repositories
 * can be tested without hitting Vercel Blob. Production wires the
 * `VercelBlobAdapter`; tests use `InMemoryBlobAdapter`.
 *
 * All values are stored as UTF-8 strings (JSON-serialised entities). Paths are
 * forward-slash-separated and unique within the store.
 */
export interface BlobStorageAdapter {
  /** Write `body` at `pathname`, overwriting any existing value. */
  put(pathname: string, body: string): Promise<void>;
  /** Read the body at `pathname`. Returns null when absent. */
  get(pathname: string): Promise<string | null>;
  /** List paths with the given prefix (paginated under the hood). */
  list(prefix: string): Promise<readonly string[]>;
  /** Delete the entry at `pathname`. No-op if absent. */
  delete(pathname: string): Promise<void>;
}

// ---------------- in-memory (tests + local dev) ----------------

export class InMemoryBlobAdapter implements BlobStorageAdapter {
  private readonly blobs = new Map<string, string>();

  async put(pathname: string, body: string): Promise<void> {
    this.blobs.set(pathname, body);
  }

  async get(pathname: string): Promise<string | null> {
    return this.blobs.get(pathname) ?? null;
  }

  async list(prefix: string): Promise<readonly string[]> {
    return [...this.blobs.keys()].filter((k) => k.startsWith(prefix));
  }

  async delete(pathname: string): Promise<void> {
    this.blobs.delete(pathname);
  }

  /** Test affordance — total number of entries. */
  size(): number {
    return this.blobs.size;
  }
}

// ---------------- Vercel Blob (production) ----------------

interface VercelBlobModule {
  put(
    pathname: string,
    body: string,
    opts: {
      access: "public";
      contentType?: string;
      addRandomSuffix?: boolean;
      token?: string;
      allowOverwrite?: boolean;
    },
  ): Promise<{ url: string; pathname: string }>;
  head(pathname: string, opts?: { token?: string }): Promise<{ url: string }>;
  list(opts: {
    prefix?: string;
    cursor?: string;
    limit?: number;
    token?: string;
  }): Promise<{ blobs: Array<{ pathname: string; url: string }>; cursor?: string }>;
  del(pathname: string | string[], opts?: { token?: string }): Promise<void>;
}

export interface VercelBlobAdapterOptions {
  /** Vercel Blob read/write token. Defaults to BLOB_READ_WRITE_TOKEN env var. */
  token?: string;
  /**
   * Inject the @vercel/blob module so this module never `import`s it at the
   * top level (and unit tests don't need network). Production callers pass
   * `await import("@vercel/blob")`.
   */
  vercelBlob: VercelBlobModule;
  /**
   * Custom fetch for reading blob bodies. Defaults to globalThis.fetch.
   * Injectable so tests can stub the read path.
   */
  fetcher?: typeof fetch;
}

/**
 * Vercel Blob–backed adapter.
 *
 * IMPORTANT: Vercel Blob's `access: "public"` mode means anyone with the URL
 * can read the body. We use predictable pathnames so the repositories can
 * compute them, but the blob URL itself contains a store-scoped host that
 * isn't trivially guessable. For data that must be private (customer PII,
 * order context), production should either:
 *   - keep these blobs behind authenticated edge functions, or
 *   - swap this adapter for Vercel KV / Postgres for hot, sensitive paths.
 * The repositories don't care — same interface either way.
 */
export class VercelBlobAdapter implements BlobStorageAdapter {
  private readonly blob: VercelBlobModule;
  private readonly token: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(opts: VercelBlobAdapterOptions) {
    this.blob = opts.vercelBlob;
    this.token = opts.token;
    this.fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  async put(pathname: string, body: string): Promise<void> {
    await this.blob.put(pathname, body, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      ...(this.token !== undefined ? { token: this.token } : {}),
    });
  }

  async get(pathname: string): Promise<string | null> {
    try {
      const meta = await this.blob.head(
        pathname,
        this.token !== undefined ? { token: this.token } : undefined,
      );
      const response = await this.fetcher(meta.url);
      if (!response.ok) return null;
      return await response.text();
    } catch (err) {
      // Vercel Blob throws on 404 — surface as null.
      if (err instanceof Error && /not\s*found/i.test(err.message)) return null;
      throw err;
    }
  }

  async list(prefix: string): Promise<readonly string[]> {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.blob.list({
        prefix,
        limit: 1000,
        ...(cursor !== undefined ? { cursor } : {}),
        ...(this.token !== undefined ? { token: this.token } : {}),
      });
      for (const b of page.blobs) out.push(b.pathname);
      cursor = page.cursor;
    } while (cursor);
    return out;
  }

  async delete(pathname: string): Promise<void> {
    await this.blob.del(
      pathname,
      this.token !== undefined ? { token: this.token } : undefined,
    );
  }
}

// ---------------- fault injection (chaos testing) ----------------

export interface FaultInjectableBlobAdapterOptions {
  /** Wrapped adapter to delegate to when not failing. */
  inner: BlobStorageAdapter;
  /** When true, every call throws BlobAdapterOutageError. */
  outage?: boolean;
  /** When > 0, the next N calls throw; the counter decrements each throw. */
  failNext?: number;
}

export class BlobAdapterOutageError extends Error {
  constructor() {
    super("Blob storage is unavailable (fault-injected outage)");
    this.name = "BlobAdapterOutageError";
  }
}

/**
 * Test-mode wrapper that lets chaos tests simulate a Blob outage. Production
 * deployments do not use this. The PRD requires every external dependency
 * to have a defined fallback (NFR-4 / NFR-5); chaos tests use this adapter
 * to disable storage in turn and confirm the orchestrator + analytics
 * degrade gracefully.
 */
export class FaultInjectableBlobAdapter implements BlobStorageAdapter {
  private outage: boolean;
  private failNext: number;

  constructor(private readonly opts: FaultInjectableBlobAdapterOptions) {
    this.outage = opts.outage ?? false;
    this.failNext = opts.failNext ?? 0;
  }

  setOutage(on: boolean): void {
    this.outage = on;
  }
  setFailNext(n: number): void {
    this.failNext = Math.max(0, n);
  }

  private guard(): void {
    if (this.outage) throw new BlobAdapterOutageError();
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new BlobAdapterOutageError();
    }
  }

  async put(pathname: string, body: string): Promise<void> {
    this.guard();
    await this.opts.inner.put(pathname, body);
  }
  async get(pathname: string): Promise<string | null> {
    this.guard();
    return this.opts.inner.get(pathname);
  }
  async list(prefix: string): Promise<readonly string[]> {
    this.guard();
    return this.opts.inner.list(prefix);
  }
  async delete(pathname: string): Promise<void> {
    this.guard();
    await this.opts.inner.delete(pathname);
  }
}
