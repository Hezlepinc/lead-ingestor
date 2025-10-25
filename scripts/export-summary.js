// scripts/export-summary.js
import "dotenv/config";
import fs from "fs";
import { connectDB } from "../src/config/db.js";
import mongoose from "mongoose";

// use your existing Mongoose models
import { Claim } from "../src/models/Claim.js";
import { Opportunity } from "../src/models/Opportunity.js";

async function main() {
  await connectDB(); // ✅ uses same working connection logic

  const claims = await Claim.find({}).lean();
  const opps = await Opportunity.find({}).lean();

  const claimMap = new Map(claims.map(c => [c.opportunityId, c]));
  const combined = opps.map(o => {
    const claim = claimMap.get(o.opportunityId);
    return {
      opportunityId: o.opportunityId,
      region: o.region,
      status: claim?.status || "not claimed",
      latencyMs: claim?.latencyMs || null,
      createdAt: claim?.createdAt || null,
      source: o.source || "PowerPlay",
      type: o.type || "feed",
      url: o.url,
    };
  });

  const totals = {
    totalOpportunities: opps.length,
    totalClaims: claims.length,
    successfulClaims: claims.filter(c => c.status === 200).length,
    failedClaims: claims.filter(c => c.status === 404).length,
    pendingClaims: opps.filter(o => !claimMap.has(o.opportunityId)).length,
  };

  console.table(totals);

  if (!fs.existsSync("out")) fs.mkdirSync("out");
  fs.writeFileSync("out/combined.json", JSON.stringify(combined, null, 2));
  console.log("📦 Saved report → out/combined.json");

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("❌ Export failed:", err);
  process.exit(1);
});