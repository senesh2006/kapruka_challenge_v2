# @sevana/analytics

Turns the event stream into the funnels, attribution, and demand signals the merchant needs (PRD §13).

## Architecture

```
Orchestrator.StageEmitter ──┐
                            ├──► AnalyticsRecorder ──► EventRepository ──► (Vercel Blob)
WebhookReceiver → EventBus ─┘                            │
                                                         ▼
                                                  AnalyticsQueries
                                                         │
                                                         ▼
                                                  /api/analytics
                                                         │
                                                         ▼
                                                  Console Analytics page
```

## What gets recorded

`AnalyticsRecorder` listens to two surfaces and writes shared `Event`s to `EventRepository`:

| Surface | Trigger | Emitted Event |
|---|---|---|
| Orchestrator stage events | `turn.end` | `ConversationEvent` (turnRole: concierge, channel, guardrailVerdict: approved) |
| Orchestrator stage events | `order.created` | `OrderEvent` (status: created) |
| Orchestrator stage events | `shopper.demand-signal` | `DemandSignalEvent` |
| Webhook event bus | bus.publish(...) | passthrough — order / payment / fulfilment events from the retailer flow straight into the log |

Persistence failures are swallowed — recording must never break the path that produced the event. Operational logging is expected to surface a backlog.

## Aggregations

`AnalyticsQueries.summary(tenantId, range)` returns:

- **`funnel`** — distinct sessions, recommendations, orders created / paid / delivered.
- **`channelMix`** — conversation count + share per channel.
- **`demandSignals`** — top-10 catalogue gaps by frequency.
- **`paymentSuccessRate`** — succeeded / (succeeded + failed).
- **`fulfilmentSuccessRate`** — delivered / (delivered + failed).
- **`totalEvents`** — events in range.

All aggregations are computed in-process over the EventRepository list. For high-volume tenants, mirror the Blob log into a column store; the API surface is unchanged.

## Tenant isolation

Every read goes through `TenantScope` via the `EventRepository`. A query for tenant A can never see tenant B's events — verified by tests.

## Tests

11 cover: empty store → zeroed counts, distinct sessions + channel mix + share, payment + fulfilment success rates, demand-signal top-N by count, date-range filtering, per-tenant isolation, bus → recorder → repo flow, orchestrator turn.end → ConversationEvent, demand-signal stage → DemandSignalEvent, createOrder → OrderEvent.
