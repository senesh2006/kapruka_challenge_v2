export class NimError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "NimError";
  }
}

export class NimTimeoutError extends NimError {
  constructor(timeoutMs: number) {
    super(`NIM call timed out after ${timeoutMs}ms`);
    this.name = "NimTimeoutError";
  }
}

export class NimRateLimitError extends NimError {
  constructor() {
    super("NIM rate limit exceeded");
    this.name = "NimRateLimitError";
  }
}

export class VisionToolCallError extends Error {
  constructor() {
    super(
      "Vision NIM models do not support tool calling. " +
        "Route tool calls to a reasoning model instead.",
    );
    this.name = "VisionToolCallError";
  }
}

export class UnknownModelError extends Error {
  constructor(name: string) {
    super(`No model registered as "${name}"`);
    this.name = "UnknownModelError";
  }
}

export function isRetryableNimError(err: unknown): boolean {
  if (err instanceof NimRateLimitError || err instanceof NimTimeoutError) return true;
  if (err instanceof NimError && err.status !== undefined) {
    return err.status >= 500 || err.status === 429;
  }
  // Network failures arrive as generic Errors — treat as retryable.
  return err instanceof Error && err.name === "Error";
}
