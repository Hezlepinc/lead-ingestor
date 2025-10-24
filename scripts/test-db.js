// scripts/test-db.js
import "dotenv/config";
import { connectDB } from "../src/config/db.js";
import { Lead } from "../src/models/Lead.js";

(async () => {
  await connectDB();

  const fakeLead = {
    source: "PowerPlay",
    region: "Test Jacksonville",
    name: "Test User",
    email: "test@example.com",
    phone: "555-123-4567",
    zip: "32099",
    payload: { note: "manual test lead" },
  };

  await Lead.create(fakeLead);
  console.log("💾 Test lead inserted into MongoDB.");
  process.exit(0);
})();