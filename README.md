# ⚡ Lead Ingestor (Realtime PowerPlay — Final)

An always-on Node.js service that ingests PowerPlay leads in realtime via SignalR, enqueues claim jobs in Mongo, and a Python worker claims them immediately using short-lived ID tokens fetched from a secure token microservice.

The MVP starts with **Generac PowerPlay** interception and a shared pipeline for notifications and database storage.

---

## 🚀 Quickstart (Local)

1. **Install Node.js 18 +**  
   Recommended: Node 20

2. **Install dependencies**
   ```bash
   npm install
   Copy environment variables
   ```

bash
Copy code
cp .env.example .env
Fill in your values (see example below).

Run in development

bash
Copy code
npm run render:start
You should see:

pgsql
Copy code
⚠️ SendGrid disabled — using placeholder mode (no emails sent)
✅ MongoDB connected
🕵️ Monitoring PowerPlay → https://powerplay.generac.com/dealer1
🧱 Environment Example
env
Copy code

# MongoDB

MONGO_URI=mongodb+srv://leaduser:My%40SecurePass@cluster0.abcde.mongodb.net/lead-ingestor?retryWrites=true&w=majority

# SendGrid (placeholder mode)

SENDGRID_API_KEY=disabled
SENDER_EMAIL=no-reply@yourdomain.com
OFFICE_EMAIL=office@yourdomain.com

# PowerPlay

POWERPLAY_URLS=https://powerplay.generac.com/dealer1
COOKIES_PATH=cookies/dealer1.json

# Scheduler

SCHEDULER_LINK=https://launchpad.yourdomain.com/schedule?lead=
If SENDGRID_API_KEY does not start with SG., the system runs in placeholder mode and simply logs
(stub) Would send email → ... instead of sending live messages.

🗺️ Project Structure
bash
Copy code
lead-ingestor/
├── .env.example
├── package.json
├── README.md
├── PROJECT_INSTRUCTIONS.md
│
├── src/
│ ├── index.js # Main entry point (starts token microservice + SignalR)
│ ├── config.js # Central env config
│ ├── logger.js # Simple logger (new modules)
│ ├── db/
│ │   └── mongo.js # Native driver (jobs/events indexes)
│ ├── auth/
│ │   ├── tokenProvider.js # Reads id_token from region cookie JSON
│ │   └── tokenServer.js   # Express microservice: /token
│ ├── queue/
│ │   └── mongoQueue.js    # Enqueue claim jobs
│ ├── signalr/
│ │   └── signalr-listener.js # Listens for NewLeadForDealer events
│ ├── config/db.js # MongoDB connection
│ ├── models/Lead.js # Mongoose schema
│ ├── utils/emailer.js # SendGrid helper (stub-safe)
│ ├── utils/logger.js # Simple console logger
│ │
│ ├── sources/
│ │ ├── powerplay.js # Playwright interceptor
│ │ ├── websiteForm.js # (future) webhook parser
│ │ └── googleAds.js # (future) API source
│ │
│ ├── processors/
│ │ ├── leadRouter.js # Routing logic (future)
│ │ └── notifyOffice.js # Shared notification logic
│ │
│ ├── storage/leads.json # Local fallback log
│ └── server.js # (optional) API for external tools
│
└── scripts/
### Env (Node)

Set these in Render → lead-ingestor → Environment:

- MONGO_URI
- REGIONS
- POWERPLAY_API_ROOT
- SIGNALR_HUB_URL
- COOKIES_PATH
- ENABLE_SIGNALR=true
- JOB_COLLECTION=jobs, EVENT_COLLECTION=events, OPPORTUNITY_COLLECTION=opportunities
- TOKEN_SERVER_PORT=8080, TOKEN_SERVER_SECRET=change-this

Start command (Render):

```
npx playwright install chromium && node src/index.js
```

### Python Worker

Files in `python/`:
- `fast_claim_worker.py` — reads jobs from Mongo and claims in parallel
- `token_client.py` — fetches short-lived tokens from Node

Env (Render → lead-ingestor-python):
- MONGODB_URI
- POWERPLAY_API_ROOT
- MAX_PARALLEL_CLAIMS=5
- JOB_COLLECTION=jobs, CLAIMS_COLLECTION=claims
- TOKEN_SERVICE_URL=https://<node-app>.onrender.com/token
- TOKEN_SERVICE_SECRET=match TOKEN_SERVER_SECRET
├── testPowerplay.js # Local test runner
├── cookieSaver.js # Save PowerPlay sessions
└── deploy.sh # Render deployment helper
See PROJECT_INSTRUCTIONS.md for deeper architectural notes.

### Standalone Claimer (No Node / No SignalR)

For a simple polling claimer, deploy the `lead-claimer` worker:

Build command:

```
pip install -r lead-claimer/requirements.txt
```

Start command:

```
python lead-claimer/lead_claimer.py
```

Env:

- REGION=Central FL
- COOKIES_PATH=/opt/render/project/src/lead-claimer/cookies/central-fl.json (or mount a secret file)
- MONGODB_URI=... (optional to log claims/events)
- CLAIMS_COLLECTION=claims (optional)
- EVENT_COLLECTION=events (optional)
- POWERPLAY_PENDING_URL=https://powerplay.generac.com/app/powerplay3-server/api/OpportunitySummary/Pending/Dealer?PageSize=1000 (optional)
- POWERPLAY_CLAIM_URL=https://powerplay.generac.com/app/powerplay3-server/api/Opportunity/Claim (optional)
- POLL_INTERVAL=30 (optional)

Cookies format (array of cookie objects) should include `id_token`, `access_token`, `.AspNetCore.Cookies`.

🧰 Scripts
Command Action
npm start Run main entry src/index.js
npm run dev:pp Start fast PowerPlay monitors (HTTP, 1s interval by default)
npm run export:mongo Export last 6h events/claims from Mongo
npm run cookies:save Save Playwright sessions

🧠 Data Storage
Leads are saved to MongoDB using the Mongoose model in src/models/Lead.js.

Collection: leads

View data in MongoDB Atlas → Database → Collections → leads
