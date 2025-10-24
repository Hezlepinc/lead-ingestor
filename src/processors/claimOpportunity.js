import { log } from "../utils/logger.js";
import { Auth } from "../models/Auth.js";
import { Claim } from "../models/Claim.js";

export async function claimOpportunity({ page, region, id, apiRoot, cookieHeader }) {
  try {
    const auth = await Auth.findOne({ region }).lean();
    if (!auth) {
      log(`⚠️ No auth tokens for ${region}`);
    }

    const base = apiRoot.replace(/\/$/, "");
    const candidates = [
      `${base}/Opportunity/${id}/Claim`, // Canonical capitalized path
      `${base}/opportunity/${id}/claim`, // Lowercase fallback
    ];
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      referer: page.url(),
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(auth?.jwt ? { authorization: `Bearer ${auth.jwt}` } : {}),
      ...(auth?.xsrf ? { "x-xsrf-token": auth.xsrf } : {}),
    };

    const started = Date.now();
    let lastError = null;
    for (const claimUrl of candidates) {
      try {
        const res = await page.request.post(claimUrl, { headers, data: {} });
        const status = res.status();
        let body = "";
        try { body = await res.text(); } catch { /* ignore */ }
        const ms = Date.now() - started;
        log(`⚡ ${region}: claim ${id} → ${status} (${ms} ms)`);
        await Claim.create({ region, opportunityId: String(id), status, latencyMs: ms, responseBody: body });
        return { status, body };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("All claim attempts failed");
  } catch (err) {
    log(`❌ ${region}: claim ${id} failed ${err.message}`);
    return { error: err };
  }
}


