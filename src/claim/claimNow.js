import axios from "axios";
import { cfg } from "../config.js";
import { log } from "../logger.js";
import { getTokenForRegion } from "../auth/tokens.js";

export async function claimNow({ region, opportunityId, timeoutMs = 2000 }) {
  const apiRoot = (cfg.powerplayApiRoot || "").replace(/\/$/, "");
  if (!apiRoot) throw new Error("POWERPLAY_API_ROOT not set");

  const raw = await getTokenForRegion(region);
  const bearer = String(raw).replace(/^Bearer\s+/i, "");
  const headers = {
    Authorization: `Bearer ${bearer}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const candidates = [
    `${apiRoot}/Opportunity/${opportunityId}/Claim`,
    `${apiRoot}/opportunity/${opportunityId}/claim`,
  ];

  let lastErr = null;
  const started = Date.now();
  for (const url of candidates) {
    try {
      const res = await axios.post(url, {}, { headers, timeout: timeoutMs, validateStatus: () => true });
      log(`⚡ ${region}: claim ${opportunityId} → ${res.status} (${Date.now() - started} ms)`);
      return res.status;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("claim failed");
}


