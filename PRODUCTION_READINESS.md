# Cookmate AI — Production Readiness

An honest assessment of where this stands, what's hardened, and the path to scale.
Written for reviewers (incl. the Swiggy Builders Club team).

## TL;DR

Cookmate is a **well-engineered MVP**, not a toy chatbot: a typed, validated,
tested ordering **engine** with real money-safety gates, wrapped by a streaming
API and a polished web UI. It is **secure and correct for the current target
(tens to low-hundreds of users on a single instance)**, and the architecture has
a clear, documented path to horizontal scale. It is **not yet** a multi-region,
multi-instance system — and we don't claim it is.

## What makes it more than a chatbot

- **Deterministic core, not vibes.** Budget math, cart totals, and the spend cap
  are computed in code (`src/core`), not by the LLM. Unit + integration tested.
- **Money-safety gates (tested):**
  - Carts are **server-computed** from authoritative prices — the model can't
    invent a total.
  - `place_order` is bound to a reviewed **cart_id**; you can't show one cart and
    charge another.
  - **Hard max-order-value cap**, explicit **confirm gate**, and **idempotency**
    (one order per cart, retries replay).
- **Channel-agnostic engine** reused by CLI, web, and (later) WhatsApp — one
  source of truth.

## Security posture (implemented)

| Area | Status |
|---|---|
| Secrets | API key server-side only, never shipped to the browser; `.env` gitignored; logs redact keys/tokens |
| CORS | Locked to an allowlist (`CORS_ORIGIN`), not `*` |
| Rate limiting | Per-IP limit on all paid endpoints (`RATE_LIMIT_PER_MIN`) → caps abuse / bill blow-ups. `X-Forwarded-For` honored only behind a trusted proxy (`TRUST_PROXY`) — not client-spoofable |
| Confirm gate | Cart-bound and one-shot: "Place order" arms the gate for exactly that cartId, consumed on first check — a concurrent model-issued order can't ride it |
| Concurrency | Per-session busy lock: one chat turn at a time (409 otherwise), so the agent conversation can't be corrupted |
| Input validation | Every tool boundary validated with zod; chat input has a size cap |
| Security headers | `secureHeaders()` on the API |
| Error handling | Generic client errors; no stack traces leaked; tool failures are recoverable |
| Spend safety | Confirm gate + max-order cap + idempotency (above) |
| Data isolation | Pantry is **per-session** (one user's data never leaks to another) |
| Resource safety | Idle sessions evicted by TTL; hard cap on live sessions; agent iteration cap + request timeout/retries |

## Scalability — honest version

**Today (single instance):** session state, carts, idempotency, and rate-limit
buckets live in-memory. This comfortably serves the expected load (100s of users)
and survives bursts via rate limiting + session eviction. A restart drops live
sessions (the browser auto-creates a new one).

**To scale horizontally (when needed), the seams are ready:**
1. **Externalize session state** → Redis (sessions, carts, idempotency keys,
   rate-limit buckets). The stores are already small interfaces.
2. **Run N stateless API instances** behind a load balancer; the Next UI is
   already stateless.
3. **Persist users/orders/pantry** → Postgres (Neon) keyed by an authenticated
   user (replaces `MemoryPantry`).
4. **Add real auth** (OAuth) — currently sessions are anonymous.

None of these require rearchitecting — they swap an in-memory map for a shared
store at a known boundary.

## Known limitations (not hidden)

- **No end-user auth yet** — sessions are anonymous. Fine for a gated demo;
  required before a public launch.
- **Single instance / in-memory state** — see scaling section.
- **Live Swiggy provider is stubbed** — `getItems` + search-result normalization
  are marked go-live seams in `src/instamart/swiggyMcp.ts`; the demo runs on a
  clearly-labelled `[DEMO]` mock catalogue.
- **No metrics/tracing yet** — structured logs only (request IDs + a metrics
  endpoint are the next observability step).
- **Server/API layer has no automated tests yet** — the engine does.

## Verification

- `THREAT_MODEL.md` — the adversarial review of the order flow: 14 attack
  vectors, their mitigations, and where each is tested
- `bun run check` — typecheck + lint + format + engine/integration tests (green)
- CLI (`bun run dev`) and web (`bun run app`) both exercised end-to-end
- Order-safety guarantees covered by `src/engine/executor.test.ts`
- See `TESTING.md` for the full manual API + UI test playbook

## Verdict

Trustworthy and safe to demo to real users and the Swiggy team **at the stated
scale**, with money-handling done responsibly. Calling it "web-scale production"
would be premature — but the engineering is real, the safety is real, and the
road to scale is short and documented.
