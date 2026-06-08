# @sevana/observability

End-to-end tracing + structured logging keyed by tenant + session (PRD NFR-9). One conversation can be reassembled in the log aggregator from the orchestrator's spans, the analytics writes, and the webhook ingress.

## What's in the package

- **`TraceContext`** — `{ traceId, tenantId?, sessionId?, attributes? }` propagated alongside every log line.
- **`Logger`** interface — `debug` / `info` / `warn` / `error` plus `.with(partial)` to derive an enriched child.
- **`ConsoleLogger`** — production default. Writes one JSON line per call to stdout/stderr so Vercel Logs (or any aggregator) ingests it cleanly. Configurable level threshold and sink.
- **`NoopLogger`** — silent.
- **`RecordingLogger`** — for tests; in-memory `records[]`.
- **`bindOrchestratorLogging(orchestrator, logger)`** — subscribes a logger to the `Orchestrator.StageEmitter` so every stage event becomes a structured log line. `turn.error` is `error`, `loop.cap-reached` is `warn`, the rest are `info`.
- **`newTraceId()`** — short URL-safe ids.

## Wired into the platform

`api/_lib.ts` instantiates one `ConsoleLogger` per Lambda instance and calls `bindOrchestratorLogging`. Each turn enriches the context with the session id via `.with()`, so log records look like:

```json
{
  "at": 1717760000000,
  "level": "info",
  "message": "stage:shopper.curate",
  "context": { "traceId": "t-...", "tenantId": "kapruka", "sessionId": "s-..." },
  "fields": { "stage": "shopper.curate", "round": 1, "durationMs": 42, "data": { "slotIds": ["primary"] } }
}
```

## Tests

8 cover: `newTraceId` uniqueness, level filtering, `.with()` context derivation without mutating the parent, `NoopLogger` silence, `RecordingLogger` capture, end-to-end orchestrator binding (every record carries the conversation's tenant + session ids), and warn-level mapping for `loop.cap-reached`.
