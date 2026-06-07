# @sevana/console

Merchant console — the surface that merchandisers, CX, and marketing use to configure persona, rules, guardrails, and experiments, and to review conversations and analytics.

## Stack

- **React 18 + Vite 5** — fast dev server, ESM throughout
- **Tailwind CSS 3** with HSL CSS variables for theming (light + dark)
- **shadcn-style primitives** hand-rolled in `src/components/ui/` — `Button`, `Card`, `Input`, `Textarea`, `Label`, `Badge`, `Switch`, `Select`, `Drawer`
- **react-router-dom 6** for routing
- **Lucide React** for icons (no emojis — per the design-system checklist)
- **Recharts** for analytics charts

## Design system

The console's design tokens come from the `ui-ux-pro-max` skill's recommendations for SaaS / dashboard surfaces and are persisted at `design-system/sevana-console/MASTER.md`:

- **Palette** — blue primary (`hsl(224 76% 40%)`), brighter blue secondary, amber CTA/accent — "blue data + amber highlights" per the skill's analytics-dashboard recommendation.
- **Typography** — Fira Sans (body) + Fira Code (mono/numerics).
- **Layout** — fixed sidebar, sticky topbar with global search and dark-mode toggle, content area at `lg:px-10 py-8`.
- **Interaction** — `cursor-pointer` on every interactive element, smooth 150–200ms color transitions, no scale-shift hovers, visible focus rings.
- **Accessibility** — `prefers-reduced-motion` respected, every form input has a visible `<label>`, every icon-only button has `aria-label`, focus ring on every focusable element.

## Pages

| Route | Purpose |
|---|---|
| `/` | Overview — KPIs, sessions vs paid orders chart, live conversations, demand-gap signals |
| `/persona` | Persona Studio — voice, opener, opinions, language toggles, signature behaviours, live preview |
| `/merchandising` | Ranking priorities, promotions, substitution policies |
| `/guardrails` | Safety toggles (price grounding, explicit confirmation, no pressure tactics, perishables), escalation triggers |
| `/experiments` | A/B experiment cards with status, lift, confidence |
| `/conversations` | Live + recent conversations table; click to open transcript drawer |
| `/analytics` | KPI tiles, situation→paid funnel, channel mix |

All data is mocked under `src/data/mock.ts` — the orchestrator and connectors aren't wired in yet.

## Run

```bash
pnpm --filter @sevana/console dev      # http://localhost:3000 (or CONSOLE_PORT)
pnpm --filter @sevana/console build    # production build
pnpm --filter @sevana/console typecheck
```
