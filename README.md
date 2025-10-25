# ⚡ Lead Ingestor (MVP)

An always-on Node.js service that ingests leads from multiple sources (scrapers, webhooks, APIs), routes them, notifies the office, and persists them for follow-up.

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
npm start
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
│ ├── index.js # Main entry point
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
├── testPowerplay.js # Local test runner
├── cookieSaver.js # Save PowerPlay sessions
└── deploy.sh # Render deployment helper
See PROJECT_INSTRUCTIONS.md for deeper architectural notes.

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
