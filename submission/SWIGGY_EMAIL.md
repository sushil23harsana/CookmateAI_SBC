# Email to the Swiggy Builders Club team

> Send via the Builders Club application portal / the contact you applied through.
> Keep it short — the video and pitch do the heavy lifting. Fill the [brackets].

---

**Subject:** Cookmate AI — working demo + request for production Instamart access

Hi Swiggy Builders Club team,

I'm [YOUR NAME] ([EMAIL]); I applied to the Builders Club with **Cookmate AI** — an
AI assistant where a user names a dish or a budget ("healthy pasta for 2",
"₹400 dinner") and it builds a ready-to-order Swiggy Instamart cart, then places
and tracks it.

It's working end-to-end against your Instamart MCP tool schemas, today on a
clearly-labelled demo catalogue:

- **90-sec demo:** [VIDEO LINK]
- **Live app:** [LINK]   (or the repo: https://github.com/Sushil-harsana/cookmate-ai)

I built it to be safe to connect to Instamart from day one, since I know
third-party access is under security review:

- The AI can never invent a price or total — carts are computed server-side from
  Instamart data.
- Orders are bound to a reviewed cart (so the shown cart == the charged cart),
  with a hard spend cap, an explicit user confirm step, and idempotent placement.
- The API is rate-limited, input-validated, and isolates each user's data.

**Two requests:**

1. Is a **consumer-facing web (and later WhatsApp) assistant** an eligible
   production surface under the Builders Club today? I want to build toward what's
   permitted.
2. Could I get **production Instamart MCP access (OAuth 2.1 / token)** so Cookmate
   runs on real inventory? Happy to do whatever review or call you need.

Thank you for opening the platform up — excited to build on it.

Best,
[YOUR NAME]
[EMAIL] · [PHONE/LINKEDIN, optional]
