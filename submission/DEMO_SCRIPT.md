# Cookmate — demo video script (~90 seconds)

Goal: show the *wow* (it really works, beautifully) **and** the *substance*
(it handles money responsibly) — because the second part is what unblocks a
security-conscious reviewer.

Recording tips: 1080p, screen-record `http://localhost:3000` (or your live link).
Do one clean take per shot; keep the cursor calm. Voiceover or on-screen captions
both work. Keep it under 90s.

| Time | On screen | Say / caption |
|---|---|---|
| 0:00–0:07 | The welcome screen ("What are we cooking today?") | "This is Cookmate. Tell it a dish or a budget — it builds your Swiggy Instamart cart." |
| 0:07–0:14 | Tap the chip **"₹400 healthy pasta for 2"** (or type it) | "One sentence. No searching, no list-making." |
| 0:14–0:30 | The animated working states cycle: recipe → pantry → searching → budget → cart | "It plans the recipe, checks what you already have, finds real Instamart SKUs, and fits your budget." |
| 0:30–0:45 | The **cart card** appears: items with prices, total, Place order button | "Here's the cart — every price and the total are computed from Instamart data. The AI is not allowed to invent a number." |
| 0:45–0:55 | Tap **Place order** → the confirm action | "Nothing is bought until I tap to confirm. There's a hard spend cap behind this too." |
| 0:55–1:05 | The **order confirmation** card + tracking timeline; tap Refresh status | "Order placed — with live tracking." |
| 1:05–1:20 | Cut to terminal: run `bun run check` showing all tests green (or show PRODUCTION_READINESS.md) | "Under the hood: orders are idempotent and bound to the reviewed cart, the API is rate-limited, inputs validated, user data isolated. Built for your security review." |
| 1:20–1:30 | Back to the app / a title card | "Cookmate — ready to go live on Instamart. By [YOUR NAME]." |

## Before you record
- `bun run app`, open `http://localhost:3000`.
- Clear an old conversation if needed (it persists): in the browser console run
  `localStorage.clear()` then refresh, so you start on the welcome screen.
- Mention once that prices shown are a **[DEMO] sample catalogue** pending live
  access — honesty reads as credibility to a reviewer.

## Optional 15s "responsible AI" b-roll (if you want a longer cut)
Show, side by side: the confirm gate, the spend-cap rejection (set a tiny budget),
and the "below minimum order value" nudge — three guardrails in action.
