// scripts/export-collections.js
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";

// === list of collections you want to export ===
const collections = ["claims", "opportunities", "events"];

async function exportCollection(db, name) {
  const filePath = `out/${name}.jsonl`;
  await fs.promises.mkdir("out", { recursive: true });
  const stream = fs.createWriteStream(filePath, { encoding: "utf8" });

  const cursor = db.collection(name).find();
  let count = 0;
  for await (const doc of cursor) {
    stream.write(JSON.stringify(doc) + "\n");
    count++;
  }

  stream.end();
  console.log(`✅ Exported ${count} documents from "${name}" → ${filePath}`);
}

async function main() {
  console.log("🔌 Connecting to MongoDB ...");
  await mongoose.connect(process.env.MONGODB_URI);

  // ✅ Force correct database selection
  const db = mongoose.connection.client.db("test");

  // Show which DB & collections are available
  const available = (await db.listCollections().toArray()).map(c => c.name);
  console.log("📚 Connected DB:", db.databaseName);
  console.log("🗂️  Available collections:", available);

  // Export only if they exist
  for (const name of collections) {
    if (available.includes(name)) {
      await exportCollection(db, name);
    } else {
      console.warn(`⚠️  Skipping "${name}" (not found in DB)`);
    }
  }

  await mongoose.disconnect();
  console.log("✅ Done.");
}

main().catch(err => {
  console.error("❌ Export failed:", err);
  process.exit(1);
});