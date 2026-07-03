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

## Why it's safe to trust with money

The AI proposes; deterministic code disposes. These guarantees are enforced in
code the model cannot reach, and covered by automated tests:

- **The AI can never invent a price or total.** Carts are computed server-side
  from the store's own data.
- **The cart you see is the cart you're charged for.** Orders are bound to the
  exact reviewed cart — showing one thing and charging another is impossible.
- **Nothing is bought without your tap**, and a hard spend cap sits behind even
  that.
- **Retries never double-charge.** Ordering is idempotent end to end.
- The API is rate-limited, input-validated, and keeps every user's data
  isolated.

The full adversarial review — 14 attack vectors, each mapped to its mitigation
and its test — is in [THREAT_MODEL.md](THREAT_MODEL.md). An honest engineering
assessment is in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

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

**Go live on Swiggy:** set `COOKMATE_PROVIDER=swiggy` and `SWIGGY_MCP_TOKEN`
(OAuth 2.1 bearer) in `.env` — same app, real inventory. Deployment guide:
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
