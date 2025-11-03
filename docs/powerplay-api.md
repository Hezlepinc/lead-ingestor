# PowerPlay network map: capture-and-claim (minimal reference)

This doc summarizes how the PowerPlay SPA signals new leads and how to capture/claim with the least moving parts. Use it as a blueprint for a minimal worker.

## Authentication
- Primary auth: `Authorization: Bearer <JWT>` attached to SPA requests under `/app/powerplay3-server/api/...`.
- Persist per region (slugged, e.g., `central-fl`) in `COOKIES_PATH` (e.g., `/data/auth`):
  - `<slug>.json` — Playwright cookies
  - `<slug>.state.json` — Playwright storage state
  - `<slug>-token.txt` — full bearer string: `Bearer <JWT>`
- JWT expiry: read `exp` from token; schedule refresh ~5 minutes before.
- Reliable token capture: sniff the live `Authorization` header from any real SPA API request (e.g., `UserProfile` or `Pending/Dealer`). Avoid relying only on `localStorage`.

## Realtime (pre‑DOM) lead signal
- App shell: `https://powerplay.generac.com/app/` (Angular). Load this to initialize connections.
- SignalR hub: exposed as `POWERPLAY_LEADPOOL_HUB`; query usually includes `crmDealerId`.
- Message framing: ASP.NET Core JSON batches delimited by `\u001e`.
- Common event targets (case‑insensitive):
  - `NewLeadForDealer`, `HasAvailableLead`, `LeadAvailable`
  - `OpportunityAvailable`, `OpportunityCreated`, `OpportunityChanged`, `OpportunitySummaryUpdated`
- Minimal handler: `page.on('websocket', ws => ws.on('framereceived', parseFrames))`, then parse JSON messages and extract `opportunityId` from `arguments[0]`.

## Lead feed (REST)
- Endpoint: `GET /app/powerplay3-server/api/OpportunitySummary/Pending/Dealer?PageSize=...`
- Response shapes (normalize to array): `json.pagedResults` | `json.data` | `json`
- Interception order:
  - `context.route("**/OpportunitySummary/Pending/Dealer", ...)` for earliest signal
  - `page.on('request')` (STARTED) and `page.on('requestfinished')` (FINISHED + payload)
- Status handling: `200` OK → rows; `401` → refresh token immediately.

## Claim endpoints
- Candidates (prefer last known‑good per region):
  - `POST /app/powerplay3-server/api/Opportunity/{id}/Claim`
  - `POST /app/powerplay3-server/api/opportunity/{id}/claim`
  - `POST /app/powerplay3-server/api/OpportunityClaim/Claim?opportunityId={id}`
- Headers: `Authorization: Bearer <JWT>` (+ optional `X-XSRF-TOKEN` from cookie `XSRF-TOKEN` if enforced).
- Body: usually `{}` (JSON) or empty; expect 2xx when successful.

## Minimal worker outline
1) Load `<slug>.state.json` into a Playwright context; set default `Authorization` from `<slug>-token.txt`.
2) Install:
   - `context.route('**/OpportunitySummary/Pending/Dealer', continue)` (pre‑fetch)
   - `page.on('request')` and `page.on('requestfinished')` for the feed
   - `page.on('websocket')` and parse SignalR frames for lead events
3) `page.goto('https://powerplay.generac.com/app/', { waitUntil: 'domcontentloaded' })`
4) On any lead signal (SignalR or feed), extract `opportunityId`, queue a claim, and POST to the first working claim URL with `Authorization` header (and `X-XSRF-TOKEN` if present).
5) On any `401`, refresh the token (force a lightweight SPA API call and capture header), update context headers, and continue.

## Token refresh (robust)
- Headless browser + region storageState
- Load `https://powerplay.generac.com/app/`
- Listen for outgoing `/app/powerplay3-server/api/...` request and capture `Authorization`
- Save to `<slug>-token.txt`; schedule next refresh using JWT `exp`

## ENV checklist (typical)
- `POWERPLAY_URLS=https://powerplay.generac.com`
- `POWERPLAY_API_ROOT=https://powerplay.generac.com/app/powerplay3-server/api`
- `POWERPLAY_LEADPOOL_HUB=https://powerplay.generac.com/app/lead-pool-service/hubs/leadpool`
- `REGIONS="Central FL,Jacksonville FL,Ft Myers FL,Austin TX,Dallas TX"`
- `COOKIES_PATH=/data/auth`
- `AUTO_CLAIM=true` (for proactive monitor)
- `ENABLE_SIGNALR=true` (optional)
- `MONGO_URI=...` (if persisting)

## Edge cases
- No leads → no immediate `/Pending/Dealer`; rely on SignalR.
- Response shape variance → always normalize arrays.
- Token‑only sessions are normal; app cookies may be sparse.
- Keep a per‑region memory of the last successful claim path.
- Cap parallel claims; add short stagger between attempts.

## Diagnostics
- Inspect saved auth: `npm run cookies:check`
- One‑off feed test: `node scripts/fetch-opps-once.js`
- Realtime probe: `node scripts/probe-powerplay.js`
