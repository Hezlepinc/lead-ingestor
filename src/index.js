import "dotenv/config";
import { connectDB } from "./config/db.js";
import { Lead } from "./models/Lead.js";
import { startPowerPlayMonitor } from "./sources/powerplay.js";
import { Event } from "./models/Event.js";
import path from "path";
import { log } from "./utils/logger.js";

(async () => {
  await connectDB();

  const handleLead = async (data) => {
    try {
      // Decide whether to persist as Lead (user/contact) or Event (network capture)
      const isLikelyLead = Boolean(data?.email || data?.phone || data?.name || data?.payload?.customerEmail);

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

  // Split environment variables into arrays
  const urls = (process.env.POWERPLAY_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // COOKIES_PATH can be:
  // - a comma-separated list of .json files
  // - a single .json file
  // - a directory that contains region-named .json files
  const cookiesRaw = (process.env.COOKIES_PATH || "").trim();

  const regionNames = (process.env.REGIONS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!urls.length || !cookiesRaw) {
    log("❌ Missing POWERPLAY_URLS or COOKIES_PATH environment variables.");
    process.exit(1);
  }

  const slugify = (s) =>
    s
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

  let cookieFiles = [];
  if (cookiesRaw.includes(",")) {
    // explicit list of files
    cookieFiles = cookiesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (/\.json$/i.test(cookiesRaw)) {
    // single file
    cookieFiles = [cookiesRaw];
  } else {
    // directory + derive filenames from region names when available
    if (regionNames.length) {
      cookieFiles = regionNames.map((r) => path.join(cookiesRaw, `${slugify(r)}.json`));
    } else {
      // if no regions provided, assume raw path points to a directory and a single default file
      cookieFiles = [cookiesRaw];
    }
  }

  // Determine regions to use in logs; try to align lengths
  let regionsForRun = [];
  if (regionNames.length === cookieFiles.length) {
    regionsForRun = regionNames;
  } else if (regionNames.length && cookieFiles.length) {
    regionsForRun = cookieFiles.map((_, i) => regionNames[i] || `Dealer ${i + 1}`);
  } else if (cookieFiles.length) {
    regionsForRun = cookieFiles.map((f, i) => {
      const base = path.basename(f, ".json");
      return base || `Dealer ${i + 1}`;
    });
  }

  log(`🚀 Starting monitors for ${cookieFiles.length} dealer accounts...`);

  for (let i = 0; i < cookieFiles.length; i++) {
    const url = urls[i] || urls[0]; // fallback to first URL if fewer URLs
    const cookiePath = cookieFiles[i];
    const region = regionsForRun[i] || `Dealer ${i + 1}`;

    log(`🧭 Initializing monitor for ${region} using ${cookiePath}`);
    log(`🕵️ Monitoring PowerPlay (${region}) → https://powerplay.generac.com/app/`);
    startPowerPlayMonitor({ onLead: handleLead, url, cookiePath, region });

    // Small delay between launches
    await new Promise((r) => setTimeout(r, 1000));
  }
})();