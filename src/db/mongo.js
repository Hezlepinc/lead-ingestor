import { MongoClient } from "mongodb";
import { cfg } from "../config.js";
import { log } from "../logger.js";

let client;
let db;

export async function getDb() {
  if (db) return db;
  client = new MongoClient(cfg.mongoUri, { maxPoolSize: 10 });
  await client.connect();
  db = client.db();
  await ensureIndexes(db);
  log("✅ Mongo connected & indexes ready");
  return db;
}

async function ensureIndexes(db) {
  await db.collection(cfg.jobCollection).createIndex(
    { "payload.opportunityId": 1, "payload.region": 1 },
    { unique: true }
  );
  await db.collection(cfg.jobCollection).createIndex({ status: 1, createdAt: 1 });
  await db.collection(cfg.jobCollection).createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  );
}


