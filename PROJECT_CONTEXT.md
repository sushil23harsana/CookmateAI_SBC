# Cookmate AI — quick context

## What this is

An AI assistant where a user types a dish or a budget ("healthy pasta for 2", "₹400 dinner for two") and it builds a ready-to-order Swiggy Instamart grocery cart, then places and tracks the order.

Flow: `intent → recipe → real SKUs → budget-fit → cart review → (user confirms) → order → track`

Built to be safe to connect to a real e-commerce API from day one — the AI can never invent a price, orders are bound to a reviewed cart, there's a hard spend cap, and every order is idempotent.

## Stack

| Layer | What |
|---|---|
| Engine | TypeScript + Bun — `src/engine/executor.ts` (tools + safety gates) |
| LLM loop | Claude (manual tool-use loop) via `src/llm/agent.ts` |
| API server | Hono streaming SSE — `src/server/index.ts` on `:8787` |
| Web UI | Next.js 16 + Framer Motion — `web/` on `:3000` |
| Mock data | `[DEMO]` catalog in `src/instamart/mock.ts` (no Swiggy creds needed) |
| Live data | Swiggy Instamart MCP — `src/instamart/swiggyMcp.ts` (awaiting token) |

## Key files

```
src/engine/executor.ts      — model-facing tools + order-safety layer
src/llm/agent.ts            — Claude tool-use loop (streaming-aware)
src/llm/prompt.ts           — system prompt (recipe/budget/safety rules)
src/core/budget.ts          — deterministic budget optimizer (never LLM math)
src/core/cart.ts            — server-computed carts + spend cap + cartId binding
src/instamart/swiggyMcp.ts  — live Swiggy MCP client (two go-live seams marked)
src/server/sessions.ts      — per-session MemoryPantry + SSE event bus
web/components/Chat.tsx     — streaming chat orchestrator
web/components/WorkingState.tsx — per-phase animated states
web/components/CartCard.tsx / OrderCard.tsx
```

## Run

```bash
bun run app        # API :8787 + web :3000 together
bun run check      # typecheck + lint + format + all tests (CI gate)
```

## Status

- End-to-end working on demo data (mock catalog).
- Production-hardened: per-IP rate limiting, locked CORS, input validation, per-session data isolation, session TTL eviction.
- Submitted / pending: Swiggy Builders Club application for production Instamart MCP token.
- Two go-live seams in `swiggyMcp.ts` (field normalization + `getItems`); everything else is live-ready.
- Deferred: real OAuth (anonymous sessions for now), Redis for horizontal scale, Neon for persistence.

---

## Where Fable 5 makes sense in this project

Fable 5 is Anthropic's most capable generally available model — use it when the task needs deep reasoning, multi-step planning, or careful judgment. Specific places it helps here:

| Task | Why Fable 5 |
|---|---|
| **Improving the recipe-to-ingredients logic** (`src/llm/prompt.ts`) | Needs cultural knowledge, quantity reasoning, pantry-aware substitution — exactly where capability matters |
| **Budget optimizer edge cases** — nutritional trade-offs, OOS substitution strategy | Complex reasoning over multiple constraints |
| **Swiggy go-live integration** — field normalization, `getItems` via cart/bill tools | Requires reading Swiggy MCP schemas and writing tolerant mappers without breaking the safety layer |
| **Security / threat-model review** of the order flow | Needs careful adversarial thinking (prompt injection, cart-swap attacks, spend-cap bypass) |
| **End-user OAuth 2.1 PKCE flow** design | Auth flows have subtle security invariants; Fable 5 handles them without shortcuts |
| **WhatsApp adapter** — multi-turn conversation state, template push messages, webhook retry safety | Complex stateful flow design |
| **Scaling architecture decisions** — Redis schema design, Neon data model, idempotency keys across instances | Architecture trade-off reasoning |
| **Writing the Swiggy submission email / pitch refinement** | Persuasive writing with technical credibility |

For routine edits (small component tweaks, adding a route, fixing a lint error) any fast model is fine. Reach for Fable 5 when the task requires judgment, not just execution.
