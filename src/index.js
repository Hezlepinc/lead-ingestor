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

  // COOKIES_PATH can be a single directory; expand with region names to files inside
  const cookiesRoot = (process.env.COOKIES_PATH || "").trim();

  const regionNames = (process.env.REGIONS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!urls.length || !cookiesRoot) {
    log("❌ Missing POWERPLAY_URLS or COOKIES_PATH environment variables.");
    process.exit(1);
  }

  // Build concrete cookie files from regions
  const cookieFiles = regionNames.length
    ? regionNames.map((r) => path.join(cookiesRoot, `${r}.json`))
    : [cookiesRoot];

  log(`🚀 Starting monitors for ${cookieFiles.length} dealer accounts...`);

  for (let i = 0; i < cookieFiles.length; i++) {
    const url = urls[i] || urls[0]; // fallback to first URL if fewer URLs
    const cookiePath = cookieFiles[i];
    const region = regionNames[i] || `Dealer ${i + 1}`;

    log(`🧭 Initializing monitor for ${region} using ${cookiePath}`);
    startPowerPlayMonitor({ onLead: handleLead, url, cookiePath, region });

    // Small delay between launches
    await new Promise((r) => setTimeout(r, 1000));
  }
})();