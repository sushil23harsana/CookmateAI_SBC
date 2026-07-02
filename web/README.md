# Cookmate Web

A Next.js (App Router) chat UI for Cookmate AI. It talks to the **engine API**
(the Hono server in `../src/server`) over a streaming SSE connection, so the
agent's real tool phases drive the on-screen animations.

## Run (Bun)

Easiest — from the repo root, start both API + UI together:

```bash
bun run app               # API :8787 + web :3000
```

Or the two processes separately:

```bash
bun run server            # engine API on :8787 (reads the root .env)
bun run web               # this app on :3000  (same as: cd web && bun run dev)
```

Open http://localhost:3000. No `.env` is needed in `web/` — the engine reads the
root `.env`. To point the UI at a different API host, set `NEXT_PUBLIC_API_BASE`.

## What's here

| Path | Role |
|---|---|
| `app/page.tsx` · `components/Chat.tsx` | The chat shell + orchestration |
| `components/WorkingState.tsx` | The animated agent-phase indicator (recipe/pantry/search/budget/cart/order) |
| `components/CartCard.tsx` | Interactive cart with emoji line items, count-up total, Place order |
| `components/OrderCard.tsx` | Order success burst + tracking timeline |
| `lib/api.ts` | Session / SSE chat / order / track client |
| `app/globals.css` | The warm "kitchen" design system |

## Notes

- The **confirm gate** is the `Place order` button → `POST /api/order`, which arms
  a one-shot server-side gate before `place_order` runs. Money never moves on the
  model's say-so.
- Designed mobile-first; layout is responsive for phone and desktop.
- Folding the API into native Next route handlers is possible later (it's split
  out now because Next 16's Turbopack doesn't apply the webpack resolver tweak the
  engine's `.js`→`.ts` imports need).
