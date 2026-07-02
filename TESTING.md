# Testing Cookmate

Three layers: automated tests, manual API checks, and manual UI checks.
Prereq: `bun install` (root) + `cd web && bun install`, and `ANTHROPIC_API_KEY` in `.env`.

## 1. Automated (no API key needed)

```bash
bun run check     # typecheck + lint + format:check + tests  ← the one to run
bun run test      # engine unit + integration tests only
```

Covers: budget optimizer, cart math + spend cap + cart-id binding, input
validation, and the order-safety guarantees (idempotency, spend cap, confirm
gate, unknown/expired cart) — all deterministic, no LLM calls.

## 2. Manual — engine via CLI (needs API key)

```bash
bun run dev
# try:  healthy pasta for 2
#       make it ₹350 max
#       yes        (places a mock order at the confirm gate)
#       track my order

# one-shot for a demo recording (auto-declines the order):
bun src/cli.ts --once "₹400 healthy pasta for 2"
```

## 3. Manual — API (start the server: `bun run server`)

```bash
# health (reports live sessions + uptime)
curl -s localhost:8787/api/health

# create a session
SID=$(curl -s -X POST localhost:8787/api/session | bun -e "process.stdin.on('data',d=>console.log(JSON.parse(d).sessionId))")

# chat (Server-Sent Events: status/cart/delta/message/done)
curl -N -X POST localhost:8787/api/chat -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"message\":\"healthy pasta for 2 under 400\"}"

# place the reviewed cart (use a cartId from the cart event above)
curl -s -X POST localhost:8787/api/order -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"cartId\":\"<cart_id>\"}"
```

### Security / hardening checks
```bash
# CORS: allowed origin reflected, others blocked
curl -s -D - -o /dev/null -H "Origin: http://localhost:3000" -X POST localhost:8787/api/session | grep -i access-control-allow-origin
curl -s -D - -o /dev/null -H "Origin: http://evil.example"   -X POST localhost:8787/api/session | grep -i access-control-allow-origin   # (no header = blocked)

# Input limits: oversized message → 413, missing message → 400, bad session → 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8787/api/chat -H 'content-type: application/json' -d "{\"sessionId\":\"x\",\"message\":\"$(printf 'a%.0s' $(seq 1 2500))\"}"

# Rate limit: burst past RATE_LIMIT_PER_MIN → 429s appear
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:8787/api/session; done; echo

# Spoofed X-Forwarded-For must NOT dodge the limit (TRUST_PROXY=false default):
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code} " -H "X-Forwarded-For: 10.0.0.$i" -X POST localhost:8787/api/session; done; echo

# Busy lock: a second chat while one is streaming → 409 (send a chat, then immediately:)
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8787/api/chat -H 'content-type: application/json' -d "{\"sessionId\":\"$SID\",\"message\":\"hi\"}"
```

The full attack-vector → mitigation → test mapping lives in `THREAT_MODEL.md`.

## 4. Manual — UI (start everything: `bun run app`, open http://localhost:3000)

- Tap a suggestion (e.g. "Healthy pasta for 2"); watch the animated phases
  (recipe → searching → budget → cart).
- The **cart card** shows real prices + total; tap **Place order** → confirmation
  card + tracking timeline; tap **Refresh status**.
- Send `make it ₹300` — confirm the cart re-fits within budget.
- **Reload the page** — the conversation persists.
- Resize to a narrow / mobile viewport — layout stays clean, composer pinned.

## Going live (real Swiggy)

Set `COOKMATE_PROVIDER=swiggy` + `SWIGGY_MCP_TOKEN` in `.env`, then repeat §2–4.
First connect: verify the `normalizeSearch` field mapping and wire `getItems` in
`src/instamart/swiggyMcp.ts` (the two marked go-live seams).
