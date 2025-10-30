export const cfg = {
  mongoUri: process.env.MONGO_URI,
  regions: (process.env.REGIONS || "").split(",").map((s) => s.trim()).filter(Boolean),
  powerplayApiRoot: process.env.POWERPLAY_API_ROOT,
  signalRHubUrl: process.env.SIGNALR_HUB_URL,
  cookiesPath: process.env.COOKIES_PATH || "/opt/render/project/src/cookies",
  enableSignalR: process.env.ENABLE_SIGNALR === "true",
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 60000),
  jobCollection: process.env.JOB_COLLECTION || "jobs",
  eventCollection: process.env.EVENT_COLLECTION || "events",
  opportunityCollection: process.env.OPPORTUNITY_COLLECTION || "opportunities",
  tokenServerPort: Number(process.env.TOKEN_SERVER_PORT || 8080),
  tokenServerSecret: process.env.TOKEN_SERVER_SECRET || "changeme",
};


