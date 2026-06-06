export class KaprukaOutageError extends Error {
  constructor() {
    super("Kapruka MCP is unavailable (fault-injected outage)");
    this.name = "KaprukaOutageError";
  }
}

export class KaprukaTransientError extends Error {
  constructor(message = "fault-injected transient failure") {
    super(message);
    this.name = "KaprukaTransientError";
  }
}

export interface FaultInjectionConfig {
  /** When true, every call throws KaprukaOutageError before any work. */
  outage?: boolean;
  /** Throws KaprukaTransientError for the next N calls, then resumes. */
  failNext?: number;
}

/**
 * Test-mode fault injector used to simulate MCP outages and transient
 * failures so the orchestrator's fallback paths can be exercised without a
 * real broken transport. Never enabled in production.
 */
export class FaultInjector {
  private outage: boolean;
  private failNext: number;

  constructor(config: FaultInjectionConfig = {}) {
    this.outage = config.outage ?? false;
    this.failNext = config.failNext ?? 0;
  }

  isOutage(): boolean {
    return this.outage;
  }

  setOutage(on: boolean): void {
    this.outage = on;
  }

  setFailNext(n: number): void {
    this.failNext = Math.max(0, n);
  }

  /**
   * Called inside the call path AFTER rate-limit acquisition. Throws
   * KaprukaTransientError if failNext > 0; decrements counter on each throw.
   * Outage is handled earlier so it doesn't consume rate-limit quota.
   */
  beforeRealCall(): void {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new KaprukaTransientError();
    }
  }
}
