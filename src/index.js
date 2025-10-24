import "dotenv/config";
import { connectDB } from "./config/db.js";
import { Lead } from "./models/Lead.js";
import { startPowerPlayMonitor } from "./sources/powerplay.js";
import { log } from "./utils/logger.js";

(async () => {
  await connectDB();

  const handleLead = async (leadData) => {
    try {
      await Lead.create(leadData);
      log(`💾 Lead saved → ${leadData.email || leadData.phone || "unknown"}`);
    } catch (err) {
      log("❌ Failed to save lead:", err.message);
    }
  };

  // Split environment variables into arrays
  const urls = (process.env.POWERPLAY_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const cookiePaths = (process.env.COOKIES_PATH || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const regionNames = (process.env.REGIONS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!urls.length || !cookiePaths.length) {
    log("❌ Missing POWERPLAY_URLS or COOKIES_PATH environment variables.");
    process.exit(1);
  }

  log(`🚀 Starting monitors for ${cookiePaths.length} dealer accounts...`);

  for (let i = 0; i < cookiePaths.length; i++) {
    const url = urls[i] || urls[0]; // fallback to first URL if fewer URLs
    const cookiePath = cookiePaths[i];
    const region = regionNames[i] || `Dealer ${i + 1}`;

    log(`🧭 Initializing monitor for ${region} using ${cookiePath}`);
    startPowerPlayMonitor({ onLead: handleLead, url, cookiePath, region });

    // Small delay between launches
    await new Promise((r) => setTimeout(r, 1000));
  }
})();