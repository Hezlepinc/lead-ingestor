// scripts/exportEvents.js
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/powerplay";
const HOURS = 6;
const cutoff = new Date(Date.now() - HOURS * 60 * 60 * 1000);

// define minimal models on the fly
const eventSchema = new mongoose.Schema({}, { strict: false, collection: "events" });
const claimSchema = new mongoose.Schema({}, { strict: false, collection: "claims" });
const Event = mongoose.model("Event", eventSchema);
const Claim = mongoose.model("Claim", claimSchema);

async function main() {
  console.log(`⏱️ Exporting Mongo data since ${cutoff.toISOString()} ...`);
  await mongoose.connect(MONGO_URI, { dbName: process.env.MONGODB_DB || "powerplay" });

  const [events, claims] = await Promise.all([
    Event.find({ timestamp: { $gte: cutoff } }).sort({ timestamp: -1 }).lean(),
    Claim.find({ createdAt: { $gte: cutoff } }).sort({ createdAt: -1 }).lean(),
  ]);

  const outPath = path.resolve("mongo_snapshot.json");
  fs.writeFileSync(outPath, JSON.stringify({ events, claims }, null, 2));
  console.log(`✅ Exported ${events.length} events and ${claims.length} claims to ${outPath}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Export failed:", err);
  process.exit(1);
});


