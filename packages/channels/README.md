# @sevana/channels

Channel adapters and the framework-agnostic client SDK that every surface talks through. One agent core, many channels — widget, full-page, mobile SDK, messaging.

## What's in the package

- **`ChannelClient`** — wraps the `POST /api/turn` contract. Returns a typed `TurnResponse` (Zod-validated). Configurable endpoint, channel, tenant, headers, fetch impl.
- **`SessionStore`** — interface + `BrowserSessionStore` (uses `sessionStorage`) and `InMemorySessionStore` (tests / SSR). Persists the customer-side session id so a refresh continues the same conversation.
- **`newSessionId`** — short URL-safe random id helper.
- **Channel identifiers** — `WIDGET_CHANNEL`, `FULL_PAGE_CHANNEL`, `MOBILE_SDK_CHANNEL`, `MESSAGING_CHANNEL`.

Channel-specific React UI lives in the console package (`packages/console/src/chat/`) — the channels package itself is UI-framework-agnostic so other surfaces (mobile SDK, messaging gateway) can reuse the SDK.

## Usage

```ts
import { ChannelClient } from "@sevana/channels";

const client = new ChannelClient({
  endpoint: "/api/turn",
  channel: "full-page",
  tenantId: "kapruka",
});

// Send a turn — session id is auto-managed across calls.
const response = await client.sendTurn("Birthday cake for amma in Galle");
console.log(response.reply, response.cardRefs);
```

## Surfaces in this monorepo

| Channel | Where | Status |
|---|---|---|
| Full-page | Console `/chat` route (`packages/console/src/pages/Chat.tsx`) | ✅ end-to-end against `/api/turn` |
| Widget (in-app preview) | `packages/console/src/chat/FloatingWidget.tsx` — floating button mounted globally | ✅ talks to the same `/api/turn` |
| Widget (cross-site embed) | Separate Vite library build → `widget.js` served from Vercel | ⏭ pending |
| Mobile SDK | — | ⏭ pending (PRD 8.2 / P3) |
| Messaging (WhatsApp) | — | ⏭ pending (PRD 8.2 / P3) |

## Tests

9 cover: channel identifiers, `newSessionId` uniqueness, `InMemorySessionStore` roundtrip, posting a turn with headers and body, session continuity across calls, `resetSession` issuing a fresh id, non-2xx → `ChannelClientError` with body, empty-message rejection before the network, Zod rejection of a malformed response.
