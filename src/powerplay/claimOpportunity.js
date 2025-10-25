import { log } from "../utils/logger.js";
import { Auth } from "../models/Auth.js";
import { Claim } from "../models/Claim.js";
import fs from "fs";
import path from "path";

/**
 * Fast claim with Playwright APIRequestContext (preferred) or page.request (back-compat).
 * Accepts either { api } OR { page }.
 */
export async function claimOpportunity({
  region,
  id,
  apiRoot,
  api,                  // Playwright APIRequestContext (preferred)
  page,                 // Back-compat: Playwright Page with page.request
  cookieHeader,
  cookiePath,
  extraHeaders = {},
  timeoutMs = 1500,
}) {
  const started = Date.now();
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
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(auth?.jwt ? { authorization: `Bearer ${auth.jwt}` } : {}),
      ...(auth?.xsrf ? { "x-xsrf-token": auth.xsrf } : {}),
      ...extraHeaders,
    };

    // Optional token file override: <cookiePathBase>-token.txt containing a full "Bearer <...>"
    try {
      if (cookiePath) {
        const baseName = path.basename(cookiePath, ".json");
        const dir = path.dirname(cookiePath);
        const tokenPath = path.join(dir, `${baseName}-token.txt`);
        if (fs.existsSync(tokenPath)) {
          const token = (fs.readFileSync(tokenPath, "utf8").trim() || "");
          if (token && /^Bearer\s+/i.test(token)) {
            headers.authorization = token;
          }
        }
      }
    } catch {}

    // Choose request client
    const client = api ?? page?.request;
    if (!client) {
      throw new Error("No API client provided (expected api or page.request).");
    }

    let lastError = null;
    for (const claimUrl of candidates) {
      try {
        const res = await client.post(claimUrl, { data: {}, headers, timeout: timeoutMs });
        const status = res.status?.() ?? res.status;
        let body = "";
        try { body = (await res.text?.()) ?? (await res.body?.()).toString?.() ?? ""; } catch {}
        const ms = Date.now() - started;
        log(`⚡ ${region}: claim ${id} → ${status} (${ms} ms)`);
        await Claim.create({
          region,
          opportunityId: String(id),
          status,
          latencyMs: ms,
          responseBody: body,
        });
        return { status, body, ms };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("All claim attempts failed");
  } catch (err) {
    const ms = Date.now() - started;
    log(`❌ ${region}: claim ${id} failed ${err.message} (${ms} ms)`);
    return { error: err, ms };
  }
}


