# Cookmate shopping experience — September 2026

## What changed

- New responsive landing page with meal, grocery-list and restocking entry points, original grocery artwork and a visible Connect Swiggy action from the first render.
- Swiggy-hosted login explanation, a static example, saved drafts, same-tab OAuth return to a configured frontend origin, and useful Help and Your data pages.
- Server-side access verification before live chat or shopping. Missing, expired or failed Swiggy authorization checks never invoke the model. Anonymous paid demo chat is disabled when NODE_ENV=production.
- Separate browser resume credential with a hashed database key. The legacy public userId no longer restores a Swiggy token. Disconnect removes the saved connection and local conversation.
- One active basket version; product pack sizes, quantity edits, clearer delivery-address selection, desktop basket panel and compact mobile basket bar.
- Final order review shows the delivery address, products, bill and available payment methods. Payment lookup errors cannot silently select COD.
- Exact quantities are sent to the pricing provider. Checkout rejects changed/missing bills. Concurrent submissions are locked. An ambiguous result is not reported as a successful order with a guessed ID.
- Payment attempts and pending payments survive a browser reload. Tracking distinguishes out-for-delivery, delivered and exceptional states.
- Grocery requests shop directly without forcing a recipe. Existing model selection and hosting configuration are unchanged.

## Release behavior

Existing visitors need to connect Swiggy once after this update because legacy browser user IDs are no longer accepted as account-access credentials. Existing local conversation data is not imported into the new account session. No new environment variables are required. Keep the existing CORS_ORIGIN and approved OAuth callback configured; same-tab return accepts only an exact configured frontend origin.

Saved basket cards become history after a reload. Users can ask Cookmate to rebuild them at current prices. Disconnecting does not cancel orders in Swiggy.

## Validation

- Root TypeScript, lint, formatting and regression suites, plus the frontend production build.
- Regression tests exercise zero model calls for disconnected/expired/failed access checks, request serialization, protected restoration, address validation and disconnect.
- Pricing/order tests cover duplicate quantities, retired baskets, concurrent checkout, changed/missing bills and ambiguous results without a fake order confirmation.
- Browser checks at desktop and 390px mobile widths use a local synthetic provider: draft → connect → basket → quantity change → final review → synthetic COD order → out-for-delivery status.
- A synthetic UPI checkout survives a page reload, resumes payment tracking and confirms the same order with one checkout submission. The mobile basket starts collapsed.

No real payment or grocery order was used to validate this release. A consented live acceptance check remains necessary.

## Remaining launch work

This release improves the shopping experience; it does not establish every production-readiness claim in older project documents. In particular:

- Sessions, baskets and checkout guards are process-local. Durable order operations and reconciliation across restarts/multiple API instances are still needed before scaling. Swiggy checkout itself is not idempotent.
- A browser resume credential is sensitive and remains in browser storage. A first-party cookie/session architecture and stronger token-at-rest protections are future hardening work.
- Confirm the app’s consent display name, support contact, data retention and actual processor disclosures with the owner and Swiggy before a broader launch.
- Test live availability changes, payment cancellation and pending-payment recovery against the owner's approved Swiggy setup.
