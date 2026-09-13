# Cookmate AI 🍳

**Tell it what you want to eat. It builds your Swiggy Instamart cart.**

"Healthy pasta for 2." "₹400 dinner for two." One sentence — Cookmate turns it
into a ready-to-order grocery cart: the recipe, the exact ingredients, real
store products that fit your budget, and one tap to order and track.

## What it does

1. **Understands the meal** — you name a dish or a budget; Cookmate works out
   the recipe, scales quantities to your servings, and adapts to how you eat
   ("healthy" → whole wheat and more veg; veg / vegan / Jain respected).
2. **Skips what you already have** — it remembers your pantry, so you never buy
   salt twice.
3. **Finds real products** — it searches the Instamart catalogue and picks the
   right pack size for each ingredient, at real prices.
4. **Fits your budget — with real math** — a deterministic optimizer (not the
   AI guessing) fits the best basket under your cap: essentials always in,
   extras trimmed transparently, with one tap to add them back.
5. **Shows you the cart, then waits** — every price and total is computed from
   store data. Nothing is ordered until *you* tap **Place order**.
6. **Orders and tracks** — confirm once, then follow the delivery live.

## Shopping controls

- Connect Swiggy before using live chat. The server verifies access before invoking the model; a browser-only toggle cannot bypass it.
- Review the current basket, delivery address, bill and payment method before ordering. Older baskets become read-only after an edit or reload.
- Repeated products carry their full quantity into Swiggy's bill. Checkout rechecks availability and the payable total, and stops when they change.
- A session lock and a per-cart in-flight guard prevent simultaneous submissions. Ambiguous checkout responses are not retried or presented as confirmed orders.
- Pending payment details are saved in this browser so a reload can resume checking instead of submitting another order.

These controls do not provide durable, end-to-end exactly-once ordering. Sessions and checkout guards still live in one API process; Swiggy checkout is not idempotent. Check the Swiggy app when an outcome is uncertain. See [APP_RELEASE.md](APP_RELEASE.md) for validation and remaining launch work.

## How it works

A channel-agnostic ordering engine (TypeScript on Bun) sits between the AI and
the store. The AI runs in a tool-use loop — it can search products, run the
budget optimizer, and request carts, but money operations only pass through the
engine's safety gates. A streaming API (Hono) serves a polished chat web app
(Next.js) with live agent-phase animations; the same engine also runs in a
terminal, and a WhatsApp surface can wrap it later.

- **Brain:** Claude by default, with automatic ChatGPT failover — if one
  provider runs out of credits mid-conversation, the chat continues seamlessly
  on the other.
- **Store:** runs today on a clearly-labelled `[DEMO]` catalogue with zero
  credentials; the live **Swiggy Instamart MCP** integration is already written
  to the documented Builders Club contract and flips on with a token.

## Run it

```bash
bun install && cd web && bun install && cd ..
cp .env.example .env        # add your ANTHROPIC_API_KEY (and/or OPENAI_API_KEY)

bun run app                 # API :8787 + web UI :3000 → open http://localhost:3000
```

Prefer a terminal? `bun run dev` gives the same assistant as a CLI chat.

**Go live on Swiggy:** set `COOKMATE_PROVIDER=swiggy`. Web visitors connect
their own Swiggy accounts using the hosted OAuth flow. The operator token is
not used for a visitor’s web session. Deployment guide:
[DEPLOY.md](DEPLOY.md).

## Quality

```bash
bun run check    # typecheck + lint + format + full test suite
```

The money path — cart binding, spend cap, confirm gate, idempotency, budget
math — is covered by deterministic tests that run without any API keys.
Manual test playbook: [TESTING.md](TESTING.md).

---

Built for the [Swiggy Builders Club](https://mcp.swiggy.com/builders/) — an AI
agent that treats other people's money the way it should be treated.
