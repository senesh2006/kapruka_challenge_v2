# @sevana/connectors

Retailer connector layer. Each sub-module defines the typed contract for one capability and will host concrete adapters (Kapruka MCP first).

- `catalogue/` — search, get, list categories
- `delivery/` — cities, rates, perishables, date checks
- `checkout/` — order creation, pay-link return, tracking
- `crm/` — optional identity and profile sync
