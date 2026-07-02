# Cookmate AI — Swiggy Builders Club submission

**One line:** Tell Cookmate a dish or a budget; it turns that into a ready-to-order
Swiggy Instamart cart — recipe → real SKUs → budget-fit → one-tap confirm → track.

**Builder:** [YOUR NAME] · [EMAIL] · **Live demo:** [LINK] · **Demo video:** [LINK]

---

## The problem
People know *what they want to cook* ("healthy pasta for 2", "₹400 dinner"), not
the 8 ingredients and exact SKUs to buy. Today that's a manual, multi-search chore
on Instamart. Cookmate collapses it into one sentence.

## What it does
1. **Recipe intelligence** — turns a dish into a quantity-scaled ingredient list,
   minus what the user already has (pantry memory). "Healthy" biases the choices.
2. **Real Instamart SKUs** — searches the catalogue at the user's location and
   picks the best pack per ingredient.
3. **Budget optimizer (deterministic)** — fits the best basket under a rupee cap,
   transparently showing what was trimmed.
4. **One-tap order + live tracking** — a confirm gate, then place + track.

## Why this is safe to plug into Instamart (built for your security review)
Money safety isn't an afterthought — it's the architecture:
- **The AI can never invent a price or total.** Carts are computed server-side
  from Instamart data; the model only proposes items.
- **Orders are bound to a reviewed cart** (a hashed `cart_id`) — it's impossible
  to show one cart and charge another.
- **Hard spend cap** + **explicit human confirm gate** — nothing is purchased
  without a tap; budget sets a ceiling, it does not pre-authorize spend.
- **Idempotent orders** — retries never double-charge.
- **Hardened API** — locked CORS, per-IP rate limiting, input validation/limits,
  per-user data isolation, bounded session memory.
These guarantees are covered by automated tests, and the full adversarial
review — 14 attack vectors, each mapped to its mitigation and test — is
documented in `THREAT_MODEL.md`.

## How it uses the Builders Club stack
- **Instamart MCP** (`/im`) — product search, cart/bill, place order, track.
- Auth via **OAuth 2.1 + PKCE** (per-user, on the user's own Swiggy account).
- The integration is **already wired** behind a clean provider interface; we run
  on a clearly-labelled `[DEMO]` mock today and flip to live with a token (two
  small, documented seams remain).

## Status
- ✅ Working end-to-end: web chat app (Next.js) + a channel-agnostic engine
  (TypeScript) + streaming API.
- ✅ Production-hardened, tested, documented (see `PRODUCTION_READINESS.md`).
- ⏳ Needs: production Instamart access (token) to run on live inventory.

## The ask
1. Confirmation that a **consumer web (and later WhatsApp) assistant** is an
   eligible production surface under the Builders Club.
2. **Production Instamart MCP access** so Cookmate runs on real inventory.
