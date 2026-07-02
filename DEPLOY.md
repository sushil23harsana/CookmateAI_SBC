# Deploying Cookmate

Two pieces, two hosts (both free-tier friendly):

| Piece | Host | Config |
|---|---|---|
| Engine API (Hono + Bun) | Render | `Dockerfile` + `render.yaml` (blueprint) |
| Web UI (Next.js) | Vercel | repo import, root directory = `web` |

## 1. API → Render (~5 min)

1. [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint** → pick the
   `cookmate-ai` GitHub repo. Render reads `render.yaml` and shows one service: `cookmate-api`.
2. When prompted for env vars:
   - `ANTHROPIC_API_KEY` — your key (same as local `.env`)
   - `CORS_ORIGIN` — your Vercel URL (add it after step 2; `https://<project>.vercel.app`)
3. Deploy. Health check is `/api/health`; when it's green, note the URL:
   `https://cookmate-api.onrender.com` (or similar).

Free-tier note: the instance sleeps after idle and cold-starts in ~30–60 s. Before a
demo or review, open `/api/health` once to warm it.

## 2. Web → Vercel (~5 min)

1. [vercel.com/new](https://vercel.com/new) → **Import** the `cookmate-ai` repo.
2. **Root Directory: `web`** (critical — the Next app lives there). Framework auto-detects.
3. Environment variable: `NEXT_PUBLIC_API_BASE` = the Render URL from step 1
   (no trailing slash).
4. Deploy → you get `https://<project>.vercel.app`.

## 3. Wire them together

1. Back in Render: set `CORS_ORIGIN` to the exact Vercel URL → redeploy (auto).
2. Open the Vercel URL, send "₹400 healthy pasta for 2", place the demo order.
3. Paste the Vercel URL into the `[LINK]` slots in `submission/`.

## Verify

- `https://<render-url>/api/health` → `{"ok":true,...}`
- Browser devtools on the Vercel site: `/api/chat` streams SSE events, no CORS errors.
- A burst of requests from one IP returns 429s (rate limiter keyed correctly because
  `TRUST_PROXY=true` is set behind Render's proxy).

## Going live on Swiggy later

Same Render service: set `COOKMATE_PROVIDER=swiggy` + `SWIGGY_MCP_TOKEN=<oauth bearer>`
(tokens last 5 days in v1) and redeploy. Everything else is unchanged.
