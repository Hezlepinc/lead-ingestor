import { getDb } from "../db/mongo.js";
import { cfg } from "../config.js";
import { log } from "../logger.js";

export async function enqueueClaimJob({ opportunityId, region, priority = 5 }) {
  const db = await getDb();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const doc = {
    type: "claim",
    status: "queued",
    createdAt: new Date(),
    priority,
    payload: { opportunityId, region },
    expiresAt,
  };

  try {
    await db.collection(cfg.jobCollection).insertOne(doc);
    log(`🧾 Enqueued claim job opp=${opportunityId} region=${region}`);
  } catch (e) {
    if (e.code === 11000) log(`↪️ Duplicate job ignored opp=${opportunityId}`);
    else throw e;
  }
}


