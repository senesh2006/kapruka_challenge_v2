import type { Clock } from "./clock.js";
import { KAPRUKA_TOOL_NAMES } from "./tool-names.js";

/**
 * Sliding-window limiter. Callers `acquire()` and resolve as soon as a slot
 * is available; while at capacity, new callers queue and the limiter sleeps
 * exactly long enough for the oldest timestamp to fall out of the window.
 */
class SlidingWindowLimiter {
  private timestamps: number[] = [];
  private readonly waiters: Array<() => void> = [];
  private draining = false;

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.waiters.length > 0) {
        const now = this.clock.now();
        this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
        if (this.timestamps.length < this.capacity) {
          this.timestamps.push(now);
          const next = this.waiters.shift();
          next?.();
        } else {
          const oldest = this.timestamps[0] ?? now;
          const waitMs = this.windowMs - (now - oldest) + 1;
          await this.clock.sleep(waitMs);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}

export interface KaprukaRateLimits {
  /** Global per-credential limit. PRD default: 60. */
  perMinute: number;
  /** kapruka_create_order limit per credential per hour. PRD default: 30. */
  orderCreationsPerHour: number;
}

export class KaprukaRateLimiter {
  private readonly global: SlidingWindowLimiter;
  private readonly orderCreation: SlidingWindowLimiter;

  constructor(limits: KaprukaRateLimits, clock: Clock) {
    this.global = new SlidingWindowLimiter(limits.perMinute, 60_000, clock);
    this.orderCreation = new SlidingWindowLimiter(
      limits.orderCreationsPerHour,
      3_600_000,
      clock,
    );
  }

  async acquire(toolName: string): Promise<void> {
    await this.global.acquire();
    if (toolName === KAPRUKA_TOOL_NAMES.checkout.createOrder) {
      await this.orderCreation.acquire();
    }
  }
}
