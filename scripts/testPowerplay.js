import "dotenv/config";
import { connectDB } from "../src/config/db.js";
import { Lead } from "../src/models/Lead.js";
import { startPowerPlayMonitor } from "../src/sources/powerplay.js";
import { log } from "../src/utils/logger.js";

async function main() {
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
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});


