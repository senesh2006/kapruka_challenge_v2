# @sevana/orchestrator

Agent core and multi-agent loop. Hosts the orchestrator and the six specialised agents from PRD §7.

## Multi-agent loop

`Orchestrator.handleTurn({ session, tenant, customerMessage })`:

1. **Retention** loads the consented profile (if any).
2. **Concierge** reads the customer message, detects the language, and updates the working brief with intent slots.
3. **Loop (capped at `maxRounds`, PRD NFR-3):**
   - **Shopper** curates per slot through the catalogue connector.
   - **Merchandiser** applies tenant rules (rankings, exclusions, promotions).
   - **Logistics** assesses delivery via the delivery connector.
   - **Critic** checks brief coverage; if any required slot has no candidates, re-run only those slots.
4. **Guardrail** reviews the plan (factual grounding — no item that didn't come from the connector).
5. **Concierge** renders the reply.
6. **Guardrail** reviews the reply (pressure-phrasing, brand voice).
7. **Retention** persists consented updates.
8. Returns `{ reply, cardRefs, plan, briefAfter, guardrailVerdict }`.

`Orchestrator.createOrder(...)` is the explicit-confirmation-gated path (FR-10). Guardrail must approve before the connector's `createOrder` is called; the response carries the retailer pay link.

## The six agent interfaces

| Role | Interface | Implementations |
|---|---|---|
| 5.1 Concierge | `ConciergeAgent.read` + `present` | `NimConciergeAgent` (production — NIM tool-calling brief extraction + persona-voiced presentation, graceful fallback on gateway failure) / `StubConciergeAgent` (tests + previews) |
| 5.2 Shopper | `ShopperAgent.curateSlot` | `CatalogueShopperAgent` (real catalogue search via the connector) |
| 5.3 Logistics | `LogisticsAgent.assess` | `ConnectorLogisticsAgent` (real `checkDelivery`) |
| 5.4 Merchandiser | `MerchandiserAgent.apply` | `TenantRulesMerchandiserAgent` (reads tenant config) |
| 5.5 Retention | `RetentionAgent.load` + `update` | `InMemoryRetentionAgent` (consent-gated) |
| 5.6 Guardrail | `GuardrailAgent.reviewPlan` + `reviewReply` + `reviewOrder` | `DefaultGuardrailAgent` (factual grounding + pressure-phrasing block + confirmation gate) |

Stub agents drive the orchestrator loop end-to-end without NIM. Production replaces the Concierge stub (and any other intelligence) with NIM-backed implementations via `@sevana/model-gateway` — the orchestrator code does not change.

## Events

Every stage emits a typed `StageEvent` (`turn.start`, `concierge.read`, `shopper.curate`, `shopper.demand-signal`, `merchandiser.apply`, `logistics.assess`, `guardrail.plan/reply/order`, `loop.refine`, `loop.cap-reached`, `concierge.present`, `order.created`, `turn.end`, `turn.error`). Analytics + tracing subscribe via `orchestrator.on(listener)`.
