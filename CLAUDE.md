# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Afghan Followers (afghanfollowers.online) — an SMM (social media marketing) panel selling
Instagram/TikTok/Telegram/YouTube/Facebook followers, likes and views, plus a "Free Likes"
referral program. Customer- and admin-facing UI is in Persian/Farsi. There is no build system:
plain static HTML/CSS/JS served by Vercel, backed by Vercel Serverless Functions in `api/`.

## Commands

There is no build, lint, or test tooling in this repo (no bundler, no `.eslintrc`, no test
framework, no CI workflow). `package.json` has a single dependency (`sharp`, used only by
`api/_autopost-image.js`) and no scripts.

- Install deps: `npm install`
- Local API development: `vercel dev` (requires the Vercel CLI and the env vars listed below)
- Deploy: pushing to the connected branch triggers a Vercel deployment; there's no separate
  build step to run first.
- There's no automated test suite — verify changes by exercising the actual page/endpoint
  (e.g. `vercel dev` + curl for API changes, opening the HTML file in a browser for UI changes).

## Architecture

### Frontend: monolithic static HTML pages

Each top-level `.html` file is a large, self-contained page (own inline `<script>`/`<style>`,
no shared JS modules between pages): `index.html` (landing), `auth.html` (login/register),
`smm-panel.html` (customer dashboard/ordering), `admin.html` (admin panel), `blog.html`,
`paypal-checkout.html` / `payment/paypal.html` (PayPal redirect flow). Each of
`admin.html`/`smm-panel.html`/`auth.html` embeds a shared constant `DB_CLIENT_KEY` used to
authenticate first-party browser calls to `/api/db` (see below) — it's a public constant
(visible via view-source), not a secret.

### Backend: Vercel Serverless Functions in `api/`

Files prefixed with `_` (`_auth.js`, `_dbkey.js`, `_passhash.js`, `_ratelimit.js`,
`_autopost-image.js`) are shared helper modules, **not** deployed as routes — Vercel only turns
non-underscore-prefixed files in `api/` into functions. The routed endpoints are: `db.js`,
`auth.js`, `place-order.js`, `sync-orders.js`, `paypal-verify.js`, `reset-password.js`,
`send-reset-email.js`, `notify-telegram.js`, `telegram-bot.js`, `ai-chat.js`, `api-proxy.js`,
`verify-recaptcha.js`.

**Vercel Hobby plan caps this project is deliberately built around: 12 serverless functions and
2 cron jobs per deployment.** The repo is already at the 12-function cap. This is why several
endpoints multiplex multiple operations behind a query param instead of being split into new
files:
- `auth.js` dispatches on `?action=login|register|google|admin-login`
- `sync-orders.js` dispatches on `?job=email-campaign|auto-post`, `?status=1`, `?force=1`, and a
  bare hit (the daily cron: order-status sync + blog content generation + social auto-post, all
  three independent and separately try/caught)
- `send-reset-email.js` handles both public password-reset requests and admin-triggered bulk/
  transactional email in one function, gated by which body fields are present

**When adding new server-side functionality, extend an existing endpoint's dispatch logic
(or add a helper file prefixed with `_`) rather than adding a new file to `api/`** — a 13th
function will fail to deploy on this plan. Likewise `vercel.json`'s `crons` array is already at
2 entries; a new scheduled job needs to piggyback on one of those two cron hits (see
`sync-orders.js`'s header comment) rather than adding a third cron entry.

### Data store: JSONBin.io, not a real database

There's no SQL/NoSQL database. `api/db.js` is the single data-access endpoint: it reads/writes
one JSON record in a JSONBin.io bin (`JSONBIN_BIN_ID`), with a second bin
(`JSONBIN_SVC_BIN_ID`) dedicated to the gzip-compressed service catalog (`smm_svc`) since
JSONBin's free plan caps a single record at 100KB. Every other server function and every
frontend page reads/writes through `GET`/`POST /api/db`, never JSONBin directly (except `db.js`
and `paypal-verify.js`'s own read-after-write verification, which talks to JSONBin directly for
diagnostic reasons — see its comments).

The record is a flat object of `smm_`-prefixed top-level keys (`smm_users`, `smm_orders`,
`smm_svc`, `smm_providers`, `smm_tickets`, `smm_pm` (payment methods), `smm_tg_bot`,
`smm_admin_creds`, `smm_general`, `smm_bonuses`, `smm_coupons`, etc.). The frontend keeps a
local mirror of the same keys in `localStorage` and periodically pushes/pulls the whole
relevant array. `POST /api/db` merges incoming arrays into the stored ones by `id` rather than
overwriting — see `mergeById`/`mergeUsersById` in `db.js` — because multiple browser tabs
(customer + admin + cron jobs) all push their own possibly-stale full-array snapshots
concurrently; a plain overwrite would silently drop other writers' data.

**`api/db.js` is the most security-critical file in the repo.** Because the whole `smm_users`/
`smm_orders` arrays get POSTed by browsers directly, the endpoint does NOT trust client-supplied
balances, transaction types, or order costs. Read `sanitizeCustomerUserWrites` and
`sanitizeCustomerOrderWrites` (and their extensive inline comments) before touching write
handling for users/orders/transactions — they exist specifically to stop a customer token from
forging its own balance, granting itself a bonus, editing another user's data, or under-pricing
an order. If you add a new transaction type or a new customer-writable field, it must be
threaded through these sanitizers, not just accepted at face value.

### Auth model

`api/_auth.js` implements self-signed HMAC-SHA256 JWT-shaped session tokens (`AUTH_JWT_SECRET`
env var; no external JWT library). Three roles appear in tokens: a customer (`sub` = user id,
`role: 'user'`), an admin (`sub` = admin username, `role: 'admin'`), and a synthetic
server-to-server "service" identity (`sub: 'service'`, `role: 'admin'`, minted by
`_dbkey.js`'s `dbHeaders()`) used whenever one serverless function calls another internally
(e.g. `place-order.js` → `/api/db`). Passwords are hashed with a salted, 3000-round SHA-256
stretch (`_passhash.js`) that mirrors client-side hashing logic embedded in the HTML pages byte
for byte — if you change one side, you must change the other or existing accounts break.

Separately, `DB_SERVICE_KEY` (sent as the `x-db-key` header) is a coarser gate present on nearly
every endpoint — it distinguishes "a first-party page/server call" from "the open internet," but
is a constant baked into public page source, so it is **not** a substitute for the real
role-based auth check above on anything sensitive (see the SSRF/open-relay history documented in
`api-proxy.js` and `place-order.js`'s comments for what happens when it's treated as one).

### Internal server-to-server calls

`api/_dbkey.js`'s `fetchInternal()` must be used (instead of a plain `fetch`) for any serverless
function calling another one of this project's own `/api/*` routes. It follows redirects
manually rather than relying on the Fetch default, because a same-origin canonical-domain
redirect (apex↔www) otherwise silently strips the `Authorization` header per the Fetch spec —
see the comments in that file for the debugging history.

### External integrations

- **JSONBin.io** — the entire persistence layer (see above).
- **Telegram** — `api/telegram-bot.js` is a full bot webhook handler (ordering, top-up, PayPal
  flow, balance, support tickets — mirrors `smm-panel.html`'s own flows for chat-based use).
  `api/notify-telegram.js` is a separate one-way admin-notification/broadcast sender.
- **PayPal** — `api/paypal-verify.js` independently re-verifies a captured PayPal order against
  PayPal's own REST API before crediting a wallet; never trusts a client-reported "payment
  succeeded." Includes a write-then-read-back verification retry loop to work around JSONBin
  read-after-write staleness (see its comments).
- **Resend** — transactional/bulk email (`api/send-reset-email.js`), also used by
  `sync-orders.js`'s weekly re-engagement campaign job.
- **Groq** — `api/ai-chat.js`, a scoped customer-support chatbot (Persian-language system prompt
  restricting it to site-related topics).
- **Google reCAPTCHA v2** — `api/verify-recaptcha.js`, server-side token verification.
- **Google Sign-In** — verified server-side in `api/auth.js`'s `handleGoogleLogin` via Google's
  `tokeninfo` endpoint (never trusts a client-decoded credential).
- **Facebook Graph API** — optional cross-posting from `notify-telegram.js` and the auto-post
  job in `sync-orders.js`.
- **sharp** (`api/_autopost-image.js`) — renders the daily auto-post image by overlaying
  AI-generated text onto one of three platform template PNGs (`api/_assets/`).

### Env vars

`JSONBIN_BIN_ID`, `JSONBIN_SVC_BIN_ID`, `JSONBIN_API_KEY`, `DB_SERVICE_KEY`, `AUTH_JWT_SECRET`,
`RECAPTCHA_SECRET_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `GROQ_API_KEY`, `FB_PAGE_ID`,
`FB_PAGE_TOKEN`, `TG_BOT_TOKEN` (Telegram bot webhook fallback; the bot's normal token/chat id
live in `smm_tg_bot` in the DB instead), `FONTCONFIG_FILE` (used by `_autopost-image.js`'s sharp
font rendering).
