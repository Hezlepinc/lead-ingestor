import { log } from "../utils/logger.js";
import { Auth } from "../models/Auth.js";
import { Claim } from "../models/Claim.js";

export async function claimOpportunity({ page, region, id, apiRoot, cookieHeader }) {
  try {
    const auth = await Auth.findOne({ region }).lean();
    if (!auth) {
      log(`⚠️ No auth tokens for ${region}`);
    }

    const claimUrl = `${apiRoot.replace(/\/$/, "")}/opportunity/${id}/claim`;
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      referer: page.url(),
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(auth?.jwt ? { authorization: `Bearer ${auth.jwt}` } : {}),
      ...(auth?.xsrf ? { "x-xsrf-token": auth.xsrf } : {}),
    };

    const res = await page.request.post(claimUrl, { headers, data: {} });
    const status = res.status();
    let body = "";
    try { body = await res.text(); } catch { /* ignore */ }

    log(`🚀 ${region}: claim ${id} → ${status}`);
    await Claim.create({ region, opportunityId: String(id), status, responseBody: body });
    return { status, body };
  } catch (err) {
    log(`❌ ${region}: claim ${id} failed ${err.message}`);
    return { error: err };
  }
}


