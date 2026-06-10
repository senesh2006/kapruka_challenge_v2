import type { Orchestrator, StageEvent } from "@sevana/orchestrator";

export const OBSERVABILITY_PACKAGE = "@sevana/observability";

/**
 * Trace context propagated alongside every log line so a single conversation
 * can be reassembled end-to-end across orchestrator, gateway, connectors,
 * and storage.
 */
export interface TraceContext {
  traceId: string;
  tenantId?: string;
  sessionId?: string;
  attributes?: Record<string, unknown>;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

export interface LogRecord {
  at: number;
  level: LogLevel;
  message: string;
  context: TraceContext;
  fields?: LogFields;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a new Logger with merged context — lets a callee enrich without mutating the caller. */
  with(context: Partial<TraceContext>): Logger;
}

// ---------------- ids ----------------

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newTraceId(): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
      ? Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map((n) => ALPHABET[n % ALPHABET.length])
          .join("")
      : Math.random().toString(36).slice(2, 10);
  return `t-${Date.now().toString(36)}-${rand}`;
}

// ---------------- abstract base ----------------

abstract class BaseLogger implements Logger {
  protected constructor(protected readonly context: TraceContext) {}

  debug(message: string, fields?: LogFields): void {
    this.emit("debug", message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.emit("info", message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.emit("warn", message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.emit("error", message, fields);
  }

  with(partial: Partial<TraceContext>): Logger {
    const merged: TraceContext = {
      ...this.context,
      ...partial,
      ...(partial.attributes || this.context.attributes
        ? {
            attributes: {
              ...(this.context.attributes ?? {}),
              ...(partial.attributes ?? {}),
            },
          }
        : {}),
    };
    return this.derive(merged);
  }

  protected abstract derive(context: TraceContext): Logger;
  protected abstract emit(level: LogLevel, message: string, fields?: LogFields): void;
}

// ---------------- console ----------------

export interface ConsoleLoggerOptions {
  /** Lowest level that's emitted. Default: "info". */
  level?: LogLevel;
  /** Sink for the log record. Default: `console`. */
  sink?: (level: LogLevel, line: string) => void;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function defaultSink(level: LogLevel, line: string): void {
  // Vercel Logs picks up stdout/stderr; warn/error go to stderr, the rest to stdout.
  if (level === "error" || level === "warn") {
    if (typeof process !== "undefined" && process.stderr) {
      process.stderr.write(`${line}\n`);
      return;
    }
    if (typeof console !== "undefined") {
      if (level === "error") console.error(line);
      else console.warn(line);
      return;
    }
  }
  if (typeof process !== "undefined" && process.stdout) {
    process.stdout.write(`${line}\n`);
    return;
  }
  if (typeof console !== "undefined") console.log(line);
}

/**
 * Structured JSON-line logger. Each call emits one self-contained line so
 * external log aggregators (Vercel Logs, Datadog, etc.) can parse it.
 */
export class ConsoleLogger extends BaseLogger {
  private readonly minLevel: LogLevel;
  private readonly sink: (level: LogLevel, line: string) => void;

  constructor(opts: ConsoleLoggerOptions = {}, context: TraceContext = { traceId: newTraceId() }) {
    super(context);
    this.minLevel = opts.level ?? "info";
    this.sink = opts.sink ?? defaultSink;
  }

  protected emit(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;
    const record: LogRecord = {
      at: Date.now(),
      level,
      message,
      context: this.context,
      ...(fields ? { fields } : {}),
    };
    this.sink(level, JSON.stringify(record));
  }

  protected derive(context: TraceContext): Logger {
    return new ConsoleLogger({ level: this.minLevel, sink: this.sink }, context);
  }
}

// ---------------- noop / recording ----------------

export class NoopLogger extends BaseLogger {
  constructor(context: TraceContext = { traceId: "noop" }) {
    super(context);
  }
  protected emit(): void {
    /* no-op */
  }
  protected derive(context: TraceContext): Logger {
    return new NoopLogger(context);
  }
}

export class RecordingLogger extends BaseLogger {
  readonly records: LogRecord[];

  constructor(context: TraceContext = { traceId: "rec" }, records: LogRecord[] = []) {
    super(context);
    this.records = records;
  }

  protected emit(level: LogLevel, message: string, fields?: LogFields): void {
    this.records.push({
      at: Date.now(),
      level,
      message,
      context: this.context,
      ...(fields ? { fields } : {}),
    });
  }
  protected derive(context: TraceContext): Logger {
    return new RecordingLogger(context, this.records);
  }
}

// ---------------- orchestrator adapter ----------------

const STAGE_LEVEL: Partial<Record<StageEvent["kind"], LogLevel>> = {
  "turn.start": "info",
  "turn.end": "info",
  "turn.error": "error",
  "loop.cap-reached": "warn",
  "agent.degraded": "warn",
  "guardrail.plan": "info",
  "guardrail.reply": "info",
  "guardrail.order": "info",
  "order.created": "info",
};

/**
 * Subscribe a Logger to an Orchestrator's StageEmitter. Each stage event
 * becomes one structured log line, enriched with tenantId + sessionId so the
 * whole conversation can be reassembled in the aggregator.
 *
 * Returns an unsubscribe handle.
 */
export function bindOrchestratorLogging(
  orchestrator: Orchestrator,
  logger: Logger,
): () => void {
  return orchestrator.on((event) => {
    const level: LogLevel = STAGE_LEVEL[event.kind] ?? "debug";
    const enriched = logger.with({
      tenantId: String(event.tenantId),
      sessionId: String(event.sessionId),
    });
    const fields: LogFields = {
      stage: event.kind,
      ...(event.round !== undefined ? { round: event.round } : {}),
      ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
      ...(event.data !== undefined ? { data: event.data } : {}),
      ...(event.error !== undefined ? { error: event.error } : {}),
    };
    if (level === "error") enriched.error(`stage:${event.kind}`, fields);
    else if (level === "warn") enriched.warn(`stage:${event.kind}`, fields);
    else enriched.info(`stage:${event.kind}`, fields);
  });
}
