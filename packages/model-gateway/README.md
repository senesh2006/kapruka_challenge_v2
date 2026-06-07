# @sevana/model-gateway

NVIDIA NIM client + model router + tracing + fallback. The orchestrator calls into this; nothing else does. Implements PRD §11.

## Endpoint

OpenAI-compatible: `https://integrate.api.nvidia.com/v1` for the hosted NIM. The same `NimClient` shape works against self-hosted NIM containers running on the retailer's GPUs — the `SelfHostNimClientResolver` lets a deployment swap the base URL and auth scheme without changing any agent code.

## Routing

`ModelRouter` picks a model per task and per tenant. Resolution priority:

1. **Per-task tenant override** — `tenant.taskOverrides["concierge.reply"] = "fast/mini"`.
2. **Per-kind tenant override** — `tenant.kindOverrides.reasoning = "..."`.
3. **Default by latency target** — `fast` picks lowest `latencyMs`, `quality` picks highest `promptCostPerM` as a proxy for quality, `balanced` picks lowest cost.

Vision NIM models do **not** support tool calling (PRD §11). The router refuses to route a tool-calling request to a vision profile (`UnknownModelError`), and the gateway refuses the same at a higher level with `VisionToolCallError` for a clearer error at the call site.

Default registered profiles:

| Name | Kind | Tool-calling |
|---|---|---|
| `meta/llama-3.3-70b-instruct` | reasoning | yes |
| `meta/llama-3.2-90b-vision-instruct` | vision | no |

## Gateway

`ModelGateway.run(task, ctx)` does:

1. Reject vision + tools at the door.
2. Resolve a route (`model.route.resolved` trace).
3. Call with per-attempt tracing (`model.call.start` / `model.call.end` / `model.call.error`).
4. Retry retryable errors (429, 5xx, timeouts, network) with jittered exponential backoff.
5. On exhaustion, walk the `downgradeChain` (named alternative profiles), emitting `model.fallback`.
6. If everything fails, throw — the channel layer renders `gateway.gracefulMessage()`.

## Tracing

`Tracer.emit(event)` — concrete types `NoopTracer` and `RecordingTracer` (for tests). Every event is keyed by `tenantId` + `task` + `model` so a single conversation can be traced end-to-end.

## Credentials

Per-tenant API keys are held in the closure of the `NimClient` built by `NimClientResolver.resolve(tenantId)`. The gateway never sees the key.

## Tests

18 covering: wire format + bearer auth, 429/5xx/timeout mapping, default routing, per-task override, latency targets, vision+tools rejection, retry-then-succeed, downgrade-chain fallback, non-retryable 400, graceful message, self-host adapter.
