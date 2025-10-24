// scripts/health.mjs
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";

const MONGO_URI = process.env.MONGO_URI;
const COOKIES_PATH = process.env.COOKIES_PATH || "./cookies";
const regions = (process.env.REGIONS || "").split(",").map((r) => r.trim()).filter(Boolean);

async function runHealthCheck() {
  console.log("🩺 Running PowerPlay Worker Health Check...\n");

  // 1. Mongo connection
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    return process.exit(1);
  }
  const db = client.db("powerplay");

  // 2. Cookie files
  console.log("\n📦 Checking cookie files...");
  for (const region of regions) {
    const cookieFile = path.join(COOKIES_PATH, `${region}.json`);
    if (!fs.existsSync(cookieFile)) {
      console.warn(`⚠️  Missing cookie file for ${region}`);
      continue;
    }
    const cookies = JSON.parse(fs.readFileSync(cookieFile, "utf8"));
    const expired = cookies.some((c) => c.expires && c.expires < Date.now() / 1000);
    if (expired) console.warn(`⚠️  ${region}: cookie expired`);
    else console.log(`✅ ${region}: cookie file valid`);
  }

  // 3. Tokens
  console.log("\n🔑 Checking auth tokens in Mongo...");
  const authDocs = await db.collection("auths").find().toArray().catch(async () => await db.collection("auth").find().toArray());
  if (!authDocs.length) console.warn("⚠️  No tokens stored in Mongo yet");
  else {
    for (const a of authDocs) {
      const age = a.updatedAt ? ((Date.now() - new Date(a.updatedAt)) / 3600000).toFixed(1) : "?";
      console.log(`✅ ${a.region}: JWT ${a.jwt ? "present" : "missing"}, XSRF ${a.xsrf ? "present" : "missing"}, updated ${age}h ago`);
    }
  }

  // 4. Last claims
  console.log("\n📊 Checking last claim results...");
  const last = await db.collection("claims").find().sort({ createdAt: -1 }).limit(3).toArray();
  if (!last.length) console.warn("⚠️  No claim records yet");
  else last.forEach((c) => console.log(`📄 ${c.region}: claim ${c.opportunityId} → ${c.status} @ ${new Date(c.createdAt).toLocaleString()}`));

  console.log("\n✅ Health check completed.\n");
  await client.close();
}

runHealthCheck();


