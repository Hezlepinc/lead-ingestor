import "dotenv/config";
import path from "path";
import fs from "fs";
import { connectDB } from "./config/db.js";
import { Lead } from "./models/Lead.js";
import { Event } from "./models/Event.js";
import { startPowerPlayMonitor } from "./sources/powerplay.js";
import { log } from "./utils/logger.js";

(async () => {
  // --- Resolve absolute working directory for Render ---
  const __dirname = path.resolve();

  // --- Normalize critical env vars with defaults ---
  const COOKIES_PATH =
    process.env.COOKIES_PATH && !path.isAbsolute(process.env.COOKIES_PATH)
      ? path.join(__dirname, process.env.COOKIES_PATH)
      : process.env.COOKIES_PATH || path.join(__dirname, "cookies");

  const POWERPLAY_URLS = (process.env.POWERPLAY_URLS || process.env.POWERPLAY_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const REGION_NAMES = (process.env.REGIONS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // --- Log where we’re looking for cookies ---
  log(`🍪 Cookies path resolved to: ${COOKIES_PATH}`);
  if (!fs.existsSync(COOKIES_PATH)) {
    log(`⚠️ Cookies path missing: ${COOKIES_PATH}`);
  }

  // --- Connect to Mongo ---
  await connectDB();

  // --- Lead handler logic ---
  const handleLead = async (data) => {
    try {
      const isLikelyLead = Boolean(
        data?.email || data?.phone || data?.name || data?.payload?.customerEmail
      );

      if (isLikelyLead) {
        await Lead.create(data);
        log(`💾 Lead saved → ${data.email || data.phone || data.name || "unknown"}`);
      } else {
        await Event.create(data);
        log(`📥 Event saved → ${data.type || "generic"} ${data.region ? "(" + data.region + ")" : ""}`);
      }
    } catch (err) {
      log("❌ Failed to persist data:", err.message);
    }
  };

  // --- Determine cookie files ---
  const slugify = (s) =>
    s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  let cookieFiles = [];
  if (COOKIES_PATH.includes(",")) {
    cookieFiles = COOKIES_PATH.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (/\.json$/i.test(COOKIES_PATH)) {
    cookieFiles = [COOKIES_PATH];
  } else if (REGION_NAMES.length) {
    cookieFiles = REGION_NAMES.map((r) => path.join(COOKIES_PATH, `${slugify(r)}.json`));
  } else {
    cookieFiles = [COOKIES_PATH];
  }

  // --- Determine regions to display in logs ---
  let regionsForRun = [];
  if (REGION_NAMES.length === cookieFiles.length) {
    regionsForRun = REGION_NAMES;
  } else if (REGION_NAMES.length && cookieFiles.length) {
    regionsForRun = cookieFiles.map((_, i) => REGION_NAMES[i] || `Dealer ${i + 1}`);
  } else {
    regionsForRun = cookieFiles.map((f, i) => path.basename(f, ".json") || `Dealer ${i + 1}`);
  }

  // --- Startup Summary ---
  log(`🚀 Starting monitors for ${cookieFiles.length} dealer accounts...`);

  // --- Launch watchers sequentially ---
  for (let i = 0; i < cookieFiles.length; i++) {
    const url = POWERPLAY_URLS[i] || POWERPLAY_URLS[0];
    const cookiePath = cookieFiles[i];
    const region = regionsForRun[i] || `Dealer ${i + 1}`;

    // --- Check cookie file existence before launching ---
    if (!fs.existsSync(cookiePath)) {
      log(`⚠️ Missing cookie file for ${region}: ${cookiePath}`);
      continue;
    }

    log(`🧭 Initializing monitor for ${region} using ${cookiePath}`);
    log(`🕵️ Monitoring PowerPlay (${region}) → ${url}`);

    startPowerPlayMonitor({ onLead: handleLead, url, cookiePath, region });

    await new Promise((r) => setTimeout(r, 1000)); // small stagger
  }
})();