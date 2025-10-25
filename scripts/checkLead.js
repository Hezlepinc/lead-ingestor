/**
 * scripts/checkLead.js
 *
 * Usage:
 *   node scripts/checkLead.js "Terrance McClelland"
 *   node scripts/checkLead.js "3059271"
 *
 * Searches Mongo for any Opportunity or Event matching the given name,
 * partial name, or opportunityId, and reports ingestion + claim status.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { Opportunity } from "../src/models/Opportunity.js";
import { Claim } from "../src/models/Claim.js";
import { Event } from "../src/models/Event.js";

dotenv.config();

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error("❌ Please provide a name or opportunityId, e.g.: node scripts/checkLead.js 'Terrance McClelland'");
    process.exit(1);
  }

  console.log(`🔍 Searching for: "${query}"\n`);

  await mongoose.connect(process.env.MONGODB_URI);

  const idFilter = /^\d+$/.test(query)
    ? { opportunityId: query }
    : {
        $or: [
          { "raw.customerFirstName": new RegExp(query, "i") },
          { "raw.customerLastName": new RegExp(query, "i") },
        ],
      };

  const opp = await Opportunity.findOne(idFilter).lean();
  if (opp) {
    console.log("✅ Found in Opportunities collection:\n");
    console.log({
      opportunityId: opp.opportunityId,
      region: opp.region,
      status: opp.raw?.status || "(unknown)",
      customer: `${opp.raw?.customerFirstName || ""} ${opp.raw?.customerLastName || ""}`.trim(),
      createdAt: opp.createdAt,
    });

    const claim = await Claim.findOne({ opportunityId: opp.opportunityId }).lean();
    if (claim) {
      console.log("\n📜 Claim record detected:\n");
      console.log({
        status: claim.status,
        latencyMs: claim.latencyMs,
        createdAt: claim.createdAt,
      });
    } else {
      console.log("\n⚠️ No claim log found for this opportunity.");
    }
  } else {
    console.log("⚠️ No matching Opportunity record found. Checking Event log…\n");
    const events = await Event.find({
      body: new RegExp(query, "i"),
    })
      .sort({ timestamp: -1 })
      .limit(5)
      .lean();

    if (events.length) {
      console.log(`📦 Found ${events.length} matching event(s):`);
      for (const e of events) {
        console.log({
          region: e.region,
          type: e.type,
          status: e.status,
          timestamp: e.timestamp,
        });
      }
    } else {
      console.log("❌ No event entries match that query.");
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("💥 Error:", err);
  process.exit(1);
});