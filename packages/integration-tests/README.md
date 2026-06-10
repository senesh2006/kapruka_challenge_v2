# @sevana/integration-tests

End-to-end acceptance gate for the PRD §12.1 integration checklist. One vitest file walks all 8 steps in sequence and asserts the full Sevana pipeline end-to-end.

## What runs

Real Sevana code throughout — the only fakes are the genuinely-external systems:

| Real | Fake |
|---|---|
| `TenantRepository`, `SessionRepository`, `CustomerProfileRepository`, `OrderRepository`, `EventRepository` against `InMemoryBlobAdapter` | NVIDIA NIM (`ConciergeModel` with scripted reasoning + tool-calling responses) |
| `HttpMcpClient` → `KaprukaTransport` (rate limits, cache, backoff, normalisation) → `ConnectorRegistry` | Kapruka MCP HTTP server (a `fetch` impl returning Kapruka snake_case shapes for all seven tools) |
| `Orchestrator` running the full six-agent loop with `NimConciergeAgent` | — |
| `AnalyticsRecorder` + `AnalyticsQueries` | — |
| `WebhookReceiver` with HMAC verification + `BlobIdempotencyStore` | — |

## The 8 steps

1. **Provision** a tenant with persona + languages + scoped credentials via `TenantRepository`.
2. **Connect** catalogue / delivery / checkout via the real `HttpMcpClient` → `registerKaprukaAdapter` pipeline against the fake MCP; confirm the canonical shape round-trips through normalisation by calling each capability once.
3. **NIM** wired through `NimConciergeAgent` + scripted `ConciergeModel`.
4. (Try-on skipped — PRD 6.2 follow-up.)
5. **Guardrails + languages + merchandising** read from the tenant config.
6. **Channel surface** instantiated as `full-page`; session persisted to Blob.
7. **Drive the situation**: an Aiyo-machan Tanglish message asking for a cake + sunflowers to Galle. Assert: tool-calling brief extraction, locale detection (`tanglish`), destination (`Galle`), card refs from the catalogue, feasible delivery with the perishable warning, persona-voiced reply.
8. **Order gate**: refuse `createOrder` without explicit confirmation (FR-10), then accept it with `explicitConfirmation: true` and assert the retailer pay link.
9. **Webhook**: HMAC-sign a `payment.succeeded` payload, assert accepted; replay it and assert deduplicated.
10. **Analytics**: confirm the funnel reflects the conversation + the order, the payment success rate is 1.0, and the channel mix attributes the conversation to `full-page`.
11. **Session continuity**: refresh-equivalent read recovers the persisted session.

The test is the merge gate before promoting to staging.

## i18n suite (PRD §11.3)

`tests/i18n.test.ts` covers internationalisation:

- **Real Sri Lankan phrases** — 14 fixtures across English / Sinhala (native script) / Tamil (native script) / Tanglish (Sinhala-glish + Tamil-glish romanised). Asserts correct locale detection and that the StubConciergeAgent writes the detected locale into the working brief.
- **Tenant-disabled languages** — detector never returns a locale the tenant did not enable; Sinhala script falls back to English when Sinhala is disabled.
- **Multi-currency round-trip** — `Money` / `CartLine` / `OrderContext` schemas preserve LKR / USD / GBP / AUD / EUR end-to-end including JSON serialisation. Lowercase currency codes get coerced to uppercase. Invalid codes are rejected. Documents the diaspora pattern (sender pays USD, retailer charges LKR).
- **Vernacular place names** (FR-9) — `listDeliveryCities` returns aliases (`Galu` / `Maha Nuwara` / `Yapanaya` / native-script variants), `checkDelivery` accepts the raw alias the customer typed, and the orchestrator passes `brief.destination` through unchanged so resolution stays the connector's responsibility.
- **CustomerProfile.locale** round-trips for every supported language.
