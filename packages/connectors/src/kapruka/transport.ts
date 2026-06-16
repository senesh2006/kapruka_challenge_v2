import type { McpClient } from "../mcp/client.js";
import { TtlCache } from "./cache.js";
import type { Clock } from "./clock.js";
import { wallClock } from "./clock.js";
import {
  FaultInjector,
  type FaultInjectionConfig,
  KaprukaOutageError,
  KaprukaTransientError,
} from "./fault.js";
import { KaprukaRateLimiter, type KaprukaRateLimits } from "./rate-limiter.js";

export interface KaprukaCacheTtls {
  /** TTL for `kapruka_search_products` responses. Default: 60s. */
  searchTtlMs?: number;
  /** TTL for `kapruka_get_product` responses. Default: 5 min. */
  productTtlMs?: number;
  /** TTL for `kapruka_list_categories` responses. Default: 30 min. */
  categoriesTtlMs?: number;
  /** TTL for `kapruka_list_delivery_cities` responses. Default: 30 min. */
  citiesTtlMs?: number;
}

export interface KaprukaRetryConfig {
  /** Including the first attempt. Default: 4. */
  maxAttempts?: number;
  /** Initial backoff delay in ms. Default: 200. */
  baseDelayMs?: number;
  /** Cap on a single backoff sleep. Default: 5_000. */
  maxDelayMs?: number;
}

export interface KaprukaTransportOptions {
  client: McpClient;
  clock?: Clock;
  rateLimit?: Partial<KaprukaRateLimits>;
  retry?: KaprukaRetryConfig;
  cache?: KaprukaCacheTtls;
  faultInjection?: FaultInjectionConfig;
}

interface CallOptions {
  cacheKey?: string;
  cacheTtlMs?: number;
}

export class KaprukaTransport {
  readonly fault: FaultInjector;
  readonly ttls: Required<KaprukaCacheTtls>;

  private readonly clock: Clock;
  private readonly client: McpClient;
  private readonly rateLimiter: KaprukaRateLimiter;
  private readonly cache: TtlCache<unknown>;
  private readonly retry: Required<KaprukaRetryConfig>;

  constructor(opts: KaprukaTransportOptions) {
    this.clock = opts.clock ?? wallClock;
    this.client = opts.client;
    this.rateLimiter = new KaprukaRateLimiter(
      {
        perMinute: opts.rateLimit?.perMinute ?? 60,
        orderCreationsPerHour: opts.rateLimit?.orderCreationsPerHour ?? 30,
      },
      this.clock,
    );
    this.cache = new TtlCache(this.clock);
    this.retry = {
      maxAttempts: opts.retry?.maxAttempts ?? 4,
      baseDelayMs: opts.retry?.baseDelayMs ?? 200,
      maxDelayMs: opts.retry?.maxDelayMs ?? 5_000,
    };
    this.ttls = {
      searchTtlMs: opts.cache?.searchTtlMs ?? 60_000,
      productTtlMs: opts.cache?.productTtlMs ?? 5 * 60_000,
      categoriesTtlMs: opts.cache?.categoriesTtlMs ?? 30 * 60_000,
      citiesTtlMs: opts.cache?.citiesTtlMs ?? 30 * 60_000,
    };
    this.fault = new FaultInjector(opts.faultInjection ?? {});
  }

  async call<T = unknown>(
    toolName: string,
    args: Record<string, unknown>,
    options: CallOptions = {},
  ): Promise<T> {
    if (options.cacheKey) {
      const hit = this.cache.get(options.cacheKey);
      if (hit.hit) return hit.value as T;
    }
    const result = await this.callWithRetry<T>(toolName, args);
    if (options.cacheKey && options.cacheTtlMs !== undefined) {
      this.cache.set(options.cacheKey, result, options.cacheTtlMs);
    }
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }

  cacheSize(): number {
    return this.cache.size();
  }

  private async callWithRetry<T>(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    let attempt = 0;
    let delay = this.retry.baseDelayMs;
    while (true) {
      attempt += 1;
      // Outage short-circuits before rate-limit acquisition so simulated
      // outages don't consume quota.
      if (this.fault.isOutage()) throw new KaprukaOutageError();
      try {
        await this.rateLimiter.acquire(toolName);
        this.fault.beforeRealCall();
        return await this.client.callTool<T>(toolName, args);
      } catch (err) {
        if (err instanceof KaprukaOutageError) throw err;
        if (attempt >= this.retry.maxAttempts) throw err;
        if (!isRetryable(err)) throw err;
        const jitter = Math.random() * delay * 0.2;
        await this.clock.sleep(Math.min(delay + jitter, this.retry.maxDelayMs));
        delay = Math.min(delay * 2, this.retry.maxDelayMs);
      }
    }
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof KaprukaTransientError) return true;
  if (err instanceof Error && err.name === "ZodError") return false;
  // A tool that returned isError:true is a deterministic application error
  // (bad args, validation, no such product) — retrying just burns backoff
  // cycles and latency. The HttpMcpClient tags these with `toolError`.
  if (err && typeof err === "object" && (err as { toolError?: boolean }).toolError === true) {
    return false;
  }
  // Default to retryable: network / timeout / 5xx / 429 surface as generic
  // Errors from real transports; validation errors are explicitly excluded
  // above so we don't retry a malformed payload.
  return true;
}
