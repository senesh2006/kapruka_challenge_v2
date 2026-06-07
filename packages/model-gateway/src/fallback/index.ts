export interface FallbackPlan {
  /** Total attempts including the first. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** When the primary model has exhausted retries, the gateway may switch to one
   *  of these named profiles before giving up. Tried in order. */
  downgradeChain: string[];
  /** Last-resort message returned when every attempt fails. */
  gracefulMessage: string;
}

export const DEFAULT_FALLBACK: FallbackPlan = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 4_000,
  downgradeChain: [],
  gracefulMessage:
    "I'm having trouble reaching the model right now. Let me try a different approach in a moment.",
};
