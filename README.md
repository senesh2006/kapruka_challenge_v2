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

## Status

This commit is a **scaffold only** — directory tree, configs, and the shared data model. No business logic is implemented yet; that is the work of subsequent phases per the PRD rollout plan.
