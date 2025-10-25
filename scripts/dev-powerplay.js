import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { startFastMonitors } from "../src/powerplay/fastMonitor.js";
import { log } from "../src/utils/logger.js";

// Minimal regions set. Add/remove as needed.
const API_ROOT = "https://powerplay.generac.com/app/powerplay3-server/api";

const regions = [
  { name: "Dallas TX",   apiRoot: API_ROOT },
  { name: "Central FL",  apiRoot: API_ROOT },
  // add other regions you have Auth for...
];

async function main() {
  const mongo = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/powerplay";
  await mongoose.connect(mongo, { dbName: process.env.MONGODB_DB || "powerplay" });
  log("🔗 Mongo connected");

  // Run monitors
  const controller = await startFastMonitors({
    regions,
    intervalMs: Number(process.env.PP_POLL_INTERVAL_MS || 2000),
    pageSize: Number(process.env.PP_PAGE_SIZE || 50),
  });

  const shutdown = async (sig) => {
    log(`\n${sig} received, shutting down...`);
    await controller.stop();
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch(err => {
  log(`❌ startup failed: ${err.stack || err.message}`);
  process.exit(1);
});


