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

  await startPowerPlayMonitor({ onLead: handleLead });
})();


