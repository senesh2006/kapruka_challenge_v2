# Sevana

> An agentic conversational commerce platform. Launch integration: Kapruka.com.

Sevana is a B2B SaaS platform that gives any retailer an agentic shopping concierge ("Hari"): a multi-agent AI that reads a customer's situation, has a point of view, coordinates products from the retailer's live catalogue, handles delivery, and completes checkout — across web, app, and messaging.

This repository is a **pnpm workspaces monorepo** in **TypeScript / Node 20**, with a **React + Vite** merchant console. Shared types and the PRD data model are defined with **Zod** so they are runtime-validatable and statically typed in one place.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript 5.4 (`strict`, `noUncheckedIndexedAccess`) |
| Runtime | Node 20 |
| Package manager | pnpm 9 (workspaces) |
| Schema / types | Zod |
| Web (console) | React 18 + Vite |
| Tests | Vitest |
| Lint / format | ESLint + Prettier |

## Repository layout

```
.
├── package.json                 # root workspace, scripts, dev tooling
├── pnpm-workspace.yaml          # workspace globs
├── tsconfig.base.json           # shared compiler options
├── tsconfig.json                # project references for the whole repo
├── .eslintrc.cjs / .prettierrc.json
├── vitest.config.ts             # repo-wide test runner config
├── .env.example                 # documented environment variables
└── packages/
    ├── shared/                  # types, PRD data model (Zod), config
    ├── model-gateway/           # NVIDIA NIM client + model routing
    ├── connectors/              # catalogue / delivery / checkout / CRM
    ├── orchestrator/            # agent core + multi-agent loop
    ├── channels/                # widget / full-page / mobile SDK / messaging
    └── console/                 # merchant console (React + Vite)
```

## Packages

### `@sevana/shared`
The single source of truth for cross-cutting types and the PRD data model — `Tenant`, `CustomerProfile`, `Session`, `Recommendation` / `Look`, `OrderContext`, and the `Event` union. Defined with Zod so every entity has both a runtime schema and an inferred static type. Also holds tenant-aware config loading and any constants shared across packages.

### `@sevana/model-gateway`
Wraps the NVIDIA NIM OpenAI-compatible endpoint (`https://integrate.api.nvidia.com/v1`). Owns per-tenant API keys, model selection (reasoning vs vision), and a routing layer so a model can be swapped by name per task / latency / cost target. The on-model try-on render is delegated to a dedicated service and is not part of NIM — this package keeps the seam for that adapter.

### `@sevana/connectors`
The connector layer that lets Sevana integrate without rebuilding retailer systems:
- **catalogue** — first implementation is the Kapruka MCP (`kapruka_search_products`, `kapruka_get_product`, `kapruka_list_categories`).
- **delivery** — `kapruka_list_delivery_cities`, `kapruka_check_delivery`, vernacular destination resolution.
- **checkout** — `kapruka_create_order` (returns the retailer's pay link), `kapruka_track_order`.
- **crm** — optional identity / profile sync for authenticated customers.

Each connector exposes a typed interface so additional retailers can plug in their own implementations.

### `@sevana/orchestrator`
The agent core. Hosts the orchestrator and the specialised agents described in the PRD:
- **Concierge** — the only voice the customer hears.
- **Shopper** — searches and curates via the catalogue connector.
- **Logistics** — destination, date, perishables.
- **Merchandiser** — promotions, ranking, substitutions.
- **Retention** — consented profile and memory.
- **Guardrail** — safety, brand voice, factual grounding, confirmation.

The multi-agent loop is implemented here; everything below the orchestrator (model calls, tool calls) goes through `model-gateway` and `connectors`.

### `@sevana/channels`
Channel adapters over a single agent core:
- **widget** — embeddable on any retailer page.
- **full-page** — dedicated concierge surface.
- **mobile-sdk** — for the retailer's app.
- **messaging** — WhatsApp and similar.

Each adapter handles rendering and session continuity; the agent core stays channel-agnostic.

### `@sevana/console`
The merchant console (React + Vite). Houses persona studio, merchandising rules, guardrails, experiments, conversation review, and analytics dashboards.

## Scripts

```bash
pnpm install           # install all workspaces
pnpm build             # build every package (tsc / vite)
pnpm typecheck         # type-only check across the repo
pnpm lint              # eslint
pnpm format            # prettier --write
pnpm test              # vitest run
pnpm test:watch        # vitest in watch mode
```

## Deploy to Vercel

The merchant console deploys as a Vite static SPA, with Vercel serverless functions at `/api/*` for the orchestrator turn endpoint and the retailer webhook receiver.

### One-time setup

1. Push the repo to GitHub (already done if you're reading this).
2. In Vercel, **Import Project** → pick `senesh2006/kapruka_challenge_v2`.
3. Vercel auto-detects pnpm via `packageManager` in `package.json`. The `vercel.json` already specifies:
   - **Build command:** `pnpm --filter @sevana/console build`
   - **Output directory:** `packages/console/dist`
   - **SPA fallback:** any non-`/api/`, non-`/assets/` path serves `index.html` (React Router).
4. Set environment variables in Vercel (Project Settings → Environment Variables):

| Variable | Used by | Notes |
|---|---|---|
| `WEBHOOK_SECRET` | `/api/webhook` | HMAC-SHA256 secret used to verify retailer webhooks. |
| `NIM_API_KEY` *(prod)* | `/api/turn` (when wired) | Per-tenant NVIDIA NIM key. The scaffold stub doesn't use this. |
| `KAPRUKA_MCP_BASE_URL` *(prod)* | `/api/turn` (when wired) | Kapruka MCP base URL for the connector. |

### What deploys

- **Static SPA** at `/` — full merchant console with seven routed pages.
- **`GET /api/health`** — health check.
- **`POST /api/turn`** — orchestrator turn endpoint. Currently a **scaffold stub** that returns a canned reply matching the `TurnResult` shape. Production wires in `@sevana/orchestrator` with the six agents + the Kapruka connector + the NIM model gateway.
- **`POST /api/webhook`** — retailer webhook endpoint. Signature-verifies the HMAC-SHA256 header and returns 202. Production wires in `@sevana/connectors/webhooks` → `WebhookReceiver`.

### Local Vercel build

```bash
pnpm run build:vercel    # what Vercel runs
pnpm --filter @sevana/console preview
```

### Verifying the deploy

```bash
curl https://<your-deploy>.vercel.app/api/health
curl -X POST https://<your-deploy>.vercel.app/api/turn \
  -H 'content-type: application/json' \
  -d '{"message":"Birthday cake for amma in Galle","sessionId":"demo"}'
```

## Phase-1 progress against the PRD build pack

| Prompt | Package | Status |
|---|---|---|
| 1.1 Scaffold the monorepo | (root) | ✅ |
| 1.2 Per-tenant data model + guard + migrations | `@sevana/shared` | ✅ |
| 2.1 Connector contract | `@sevana/connectors` | ✅ |
| 2.2 Kapruka MCP connector (rate-limits, cache, backoff, fault injection) | `@sevana/connectors/kapruka` | ✅ |
| 2.3 Webhook receiver | `@sevana/connectors/webhooks` | ✅ |
| 3.1 NIM client + model router + fallback | `@sevana/model-gateway` | ✅ |
| 4.1 Orchestrator + multi-agent loop | `@sevana/orchestrator` | ✅ |
| 5.1–5.6 The six agents (interfaces + stub impls) | `@sevana/orchestrator/agents` | ✅ |
| 6.1 End-to-end commerce flow | — | ⏭ pending |
| 7.1 Personalisation store | — | ⏭ pending |
| 8.1 Widget + full-page channels | `@sevana/channels` | ⏭ pending |
| 9.x Merchant console pages | `@sevana/console` | ✅ (mocked data) |
| 10.1 Analytics | partial in console | ⏭ pending (real wiring) |
| 11.x Hardening | — | ⏭ pending |
| 12.1 Staging validation | — | ⏭ pending |
