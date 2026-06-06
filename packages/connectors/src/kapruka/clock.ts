export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const wallClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
};
