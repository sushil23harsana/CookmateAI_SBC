# Builders Club application — ready-to-paste answers

> The form at mcp.swiggy.com/builders/access asks for these fields.
> Fill the [brackets], paste the rest as-is.

**Integration name:** Cookmate AI

**Technical contact:** [YOUR NAME] · sushil.h@altrdtech.com

**Path:** Developer (an agent calling an LLM with Swiggy as a tool)

**Servers:** Instamart (`mcp.swiggy.com/im`) only, v1. (Food/Dineout: not used.)

**Use case (short):** A consumer web assistant: the user names a dish or a
budget ("healthy pasta for 2", "₹400 dinner") and Cookmate turns it into a
ready-to-order Instamart cart — recipe → real SKUs → deterministic budget-fit
→ explicit confirm → order → track. Money safety is architectural: the model
can never invent a price, orders are bound to a reviewed cart, and checkout
always sits behind a user confirmation (see THREAT_MODEL.md in the repo).

**Redirect URIs:**
- Development: `http://localhost:8787/oauth/callback`
- Production: `https://[YOUR-DOMAIN]/oauth/callback` (to be allowlisted at deploy)

**Volume estimates (honest, early-stage):**
- Expected users at launch: ~100; concurrent sessions typically < 10.
- Per completed order journey: ~10–12 Instamart tool calls over ~a minute
  (mostly `search_products` reads; 3–4 writes: `update_cart` ×2 + `checkout`).
- Sustained: **< 1 QPS**; peak bursts: **~2–5 QPS**. Default developer tier
  (120 req/min/user, 30/min writes) is more than sufficient — no raise needed.
- Our own service enforces ceilings upstream of Swiggy: 24 tool iterations max
  per agent turn, per-IP rate limiting (30 req/min default), tracking polled
  manually (never faster than the documented 10 s).

**Demo video:** [VIDEO LINK] — 90 s, working end-to-end on a clearly-labelled
demo catalogue pending production access.

**Repo / live app:** https://github.com/sushil23harsana/CookmateAI_SBC · [LINK]
