# Cookmate AI — core engine (Phase 0, production-grade)

Tell Cookmate a **dish** or a **budget**; it turns that into a ready-to-confirm
Swiggy Instamart cart, then places and tracks the order. This is the
**channel-agnostic core engine + a terminal harness** — the same engine a web app
or WhatsApp adapter will wrap later.

```
intent → recipe → real SKUs → budget-fit → review cart → (confirm) → order → track
```

## Architecture

| Path | Role |
|---|---|
| `src/engine/executor.ts` | **The engine.** Declares every model-facing tool and executes it behind the safety layer (validation, cart binding, spend cap, idempotency, confirm gate). Channel-agnostic. |
| `src/llm/agent.ts` | Claude tool-use loop (manual loop = human-in-the-loop gate; iteration cap). |
| `src/llm/prompt.ts` | The Cookmate brain — recipe, budget, pantry, "never invent a total" rules. |
| `src/core/budget.ts` | **Deterministic** budget optimizer (kept out of the LLM). |
| `src/core/cart.ts` | Server-computed carts + spend-limit guard (hashed `cartId` binds confirmation to contents). |
| `src/core/pantry.ts` | Per-user pantry memory (JSON now → Neon later). |
| `src/validation/schemas.ts` | Zod schemas at every tool boundary. |
| `src/instamart/provider.ts` | Semantic provider interface (`searchItems / getItems / placeOrder / trackOrder`). |
| `src/instamart/mock.ts` | Fake `[DEMO]` catalog — runs the whole flow with **no Swiggy creds**. |
| `src/instamart/swiggyMcp.ts` | Live Swiggy MCP client (tool discovery + tolerant normalizer). |
| `src/config.ts` · `src/errors.ts` · `src/logger.ts` | Zod-validated env, typed errors, redacting logger (stderr). |
| `src/cli.ts` | Thin terminal adapter: I/O + the confirm prompt only. |

The agent only sees the engine's tools, and **money operations are never raw
provider tools** — `place_order` goes through the gated wrapper. Swapping the
mock for live Swiggy changes only the four provider methods.

## Safety model (enforced, with tests)

- **Authoritative carts** — `review_cart` computes prices/totals from provider
  data, not the model. The model is forbidden from stating a total it didn't get
  from a tool.
- **Cart binding** — `place_order` takes a `cart_id` from `review_cart`; the order
  uses the stored canonical cart, so the model can't show one cart and order
  another.
- **Hard spend cap** — `COOKMATE_MAX_ORDER_VALUE` blocks over-limit orders before
  the gate.
- **Confirm gate** — an order is placed only after an explicit human `yes`.
- **Idempotency** — one order per cart; retries replay the same order.
- **Recoverable errors** — bad tool inputs become validation errors the model
  fixes and retries, not crashes.

These are covered by `src/engine/executor.test.ts` (deterministic, no LLM).

## Run it (Bun)

Uses [Bun](https://bun.sh) as the package manager **and** runtime (it runs the
TypeScript directly — no build step, no `tsx`).

```bash
bun install                                 # root deps
cd web && bun install && cd ..              # web deps
cp .env.example .env                        # put your ANTHROPIC_API_KEY in .env

bun run app                                 # ⭐ starts BOTH: API :8787 + web UI :3000
# then open http://localhost:3000
```

CLI / engine only:

```bash
bun run dev                                 # interactive terminal chat (mock provider)
bun src/cli.ts --once "₹400 healthy pasta for 2"   # one-shot (auto-declines order)
```

Run the two processes separately if you prefer two terminals:

```bash
bun run server      # backend API on :8787
bun run web         # frontend on :3000
```

### Go live against Swiggy Instamart

1. `.env`: `COOKMATE_PROVIDER=swiggy` and `SWIGGY_MCP_TOKEN=<bearer token>`.
2. `bun run server`. The provider discovers tools from `mcp.swiggy.com/im`.

Two clearly-marked go-live seams in `swiggyMcp.ts`: confirm the `normalizeSearch`
field mapping, and wire `getItems` to Swiggy's authoritative cart/bill tool.

## Testing

```bash
bun run check        # the full gate: typecheck + lint + format + tests
bun run test         # just the engine unit + integration tests
bun run typecheck    # types only
```

What's covered: `src/core/budget.test.ts` (optimizer), `src/core/cart.test.ts`
(cart math + spend cap + cart-id binding), `src/validation/schemas.test.ts`
(input validation), `src/engine/executor.test.ts` (the order-safety guarantees —
idempotency, spend cap, confirm gate, unknown cart). See `TESTING.md` for manual
API/UI test steps.

## Scripts

| Script | Does |
|---|---|
| `bun run app` | Start backend + frontend together |
| `bun run server` / `bun run web` | Start one side |
| `bun run dev` | Terminal chat (engine only) |
| `bun run check` | typecheck + lint + format:check + test (CI gate) |
| `bun run test` | Unit + integration tests |
| `bun run lint` / `lint:fix` · `bun run format` / `format:check` | ESLint / Prettier |

## Deliberately deferred (belongs to the web/Phase 1 service)

- Real OAuth 2.1 PKCE (bearer token is the Phase 0 shortcut).
- Live Swiggy `getItems` + response normalization (the two seams above).
- Persistence beyond a JSON pantry (move users/orders/pantry to Neon).
- Deterministic quantity→pack math (currently LLM-reasoned).
- The web (and later WhatsApp) channel — both just wrap `src/engine`.
