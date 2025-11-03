import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { log } from "../utils/logger.js";
import { claimOpportunity } from "../powerplay/claimOpportunity.js";
import { sendCustomerEmail, sendOfficeEmail } from "../utils/emailer.js";
import { Auth } from "../models/Auth.js";
import { Opportunity } from "../models/Opportunity.js";

//
// === Runtime Config ===
//
const AUTO_CLAIM = process.env.AUTO_CLAIM !== "false";
const ENABLE_EVENT_COLLECTION = process.env.ENABLE_EVENT_COLLECTION !== "false";
const MAX_PARALLEL_CLAIMS = Number(process.env.MAX_PARALLEL_CLAIMS || "3");
const DEFAULT_HOSTS = ["powerplay.generac.com", "dealerinsights.generac.com"];

function isTargetApi(url) {
  return DEFAULT_HOSTS.some((h) => url.includes(h)) || url.includes("/powerplay3-server/");
}

// claimOpportunity is now imported from ../powerplay/claimOpportunity.js

//
// === Core Monitor ===
//
export async function startPowerPlayMonitor({ region, url, cookiePath, onLead }) {
  const baseUrl = url || process.env.POWERPLAY_URLS?.split(",")[0];
  if (!baseUrl) throw new Error("Missing POWERPLAY_URLS env var");

  log(`🚀 Starting PowerPlay Fast Monitor for ${region}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  });

  if (fs.existsSync(cookiePath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
    await context.addCookies(cookies);
    const count = Array.isArray(cookies) ? cookies.length : (Array.isArray(cookies?.cookies) ? cookies.cookies.length : 0);
    log(`🍪 Loaded ${count} cookies for ${region}`);
    if (!count) log(`⚠️ Cookie file appears empty for ${region}: ${cookiePath}`);
  } else {
    log(`⚠️ No cookie file found for ${region} at ${cookiePath}`);
  }

  // If we have a saved Bearer token, inject it for both browser JS and network layer
  try {
    const base = path.basename(cookiePath, ".json");
    const dir = path.dirname(cookiePath);
    const tokenPath = path.join(dir, `${base}-token.txt`);
    if (fs.existsSync(tokenPath)) {
      const bearer = (fs.readFileSync(tokenPath, "utf8").trim() || "");
      if (bearer) {
        // Set default Authorization header for all requests from this context
        await context.setExtraHTTPHeaders({ Authorization: bearer });
      }
      // Make token available to app code that reads from localStorage
      const token = bearer.replace(/^Bearer\s+/i, "");
      const storageState = { origins: [{ origin: "https://powerplay.generac.com", localStorage: [{ name: "token", value: token }] }] };
      try {
        await context.addInitScript(({ t }) => {
          try { localStorage.setItem("token", t); } catch {}
        }, { t: token });
      } catch {}
    }
  } catch {}

  const page = await context.newPage();

  // === token refresher ===
  async function refreshTokens(tag) {
    try {
      const cookies = await context.cookies();
      const xsrf = cookies.find((c) => c.name === "XSRF-TOKEN")?.value || null;
      let jwt = await page.evaluate(() => localStorage.getItem("token") || null);
      // Fallback: read saved Bearer token from token file if localStorage token is missing
      if (!jwt && cookiePath) {
        try {
          const base = path.basename(cookiePath, ".json");
          const dir = path.dirname(cookiePath);
          const tokenPath = path.join(dir, `${base}-token.txt`);
          if (fs.existsSync(tokenPath)) {
            const raw = (fs.readFileSync(tokenPath, "utf8").trim() || "");
            if (raw) jwt = raw.replace(/^Bearer\s+/i, "");
          }
        } catch {}
      }
      if (xsrf || jwt) {
        await Auth.updateOne(
          { region },
          { $set: { xsrf, jwt, updatedAt: new Date() } },
          { upsert: true }
        );
        log(`🔑 ${region}: tokens refreshed (${tag})`);
        // Also update network headers to ensure subsequent polls succeed
        if (jwt) {
          try {
            await context.setExtraHTTPHeaders({ Authorization: `Bearer ${jwt}` });
          } catch {}
        }
      }
    } catch (e) {
      log(`⚠️ ${region}: token refresh failed ${e.message}`);
    }
  }

  // === claim queue ===
  const claimQueue = [];
  let activeClaims = 0;

  async function enqueueClaim({ id, apiRoot, cookieHeader }) {
    if (!AUTO_CLAIM) return;
    if (claimQueue.find((q) => q.id === id)) return;
    claimQueue.push({ id, apiRoot, cookieHeader });
    processQueue();
  }

  async function processQueue() {
    if (activeClaims >= MAX_PARALLEL_CLAIMS || claimQueue.length === 0) return;
    const { id, apiRoot, cookieHeader } = claimQueue.shift();
    activeClaims++;
    try {
      await claimOpportunity({ page, region, id, apiRoot, cookieHeader, cookiePath });
    } catch (e) {
      log(`⚠️ ${region}: claim ${id} failed ${e.message}`);
    } finally {
      activeClaims--;
      processQueue();
    }
  }

  // === handle incoming leads ===
  async function handleOpportunityItems(items, apiRoot) {
    if (!Array.isArray(items) || items.length === 0) return;

    const cookieHeader = (await context.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    await Promise.all(
      items.map(async (item) => {
        try {
          const id = String(item.opportunityId || item.id || "").trim();
          if (!id) return;

          const statusText = String(item.status || item.Status || "").trim();
          const isUnclaimed = !statusText || statusText.toUpperCase() === "E0004";

          // store or update lead event in DB
          if (ENABLE_EVENT_COLLECTION) {
            await Opportunity.updateOne(
              { opportunityId: id },
              { $set: { region, raw: item, updatedAt: new Date() } },
              { upsert: true }
            );
          }

          // optional callback for external handling (e.g., saving to Leads collection)
          if (typeof onLead === "function") {
            try {
              await onLead({
                type: "opportunity",
                id,
                region,
                source: "powerplay",
                raw: item,
              });
            } catch (e) {
              log(`⚠️ onLead callback failed for ${region}:${id} ${e.message}`);
            }
          }

          // fire auto-claim
          if (AUTO_CLAIM && isUnclaimed) {
            log(`🚨 Queuing claim for ${region} → ${id} (${statusText || "no status"})`);
            await enqueueClaim({ id, apiRoot, cookieHeader });
          }
        } catch (err) {
          log(`⚠️ ${region}: failed to process item ${err.message}`);
        }
      })
    );
  }

  // === monitor network responses ===
  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (!/\/api\//i.test(url)) return;
      const status = res.status();
      if (status === 401) return refreshTokens("401");
      const headers = res.headers();
      const type = (headers["content-type"] || "").toLowerCase();
      if (!type.includes("json")) return;

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        return;
      }

      const lower = url.toLowerCase();
      const isSummary =
        lower.includes("/api/opportunitysummary/") ||
        lower.includes("/api/opportunity/search");
      if (!isSummary) return;

      const idx = url.toLowerCase().indexOf("/api/");
      const apiRoot =
        idx !== -1
          ? url.slice(0, idx + 5)
          : `${baseUrl.replace(/\/$/, "")}/powerplay3-server/api/`;

      const items = Array.isArray(json?.pagedResults)
        ? json.pagedResults
        : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : [];

      if (items.length) await handleOpportunityItems(items, apiRoot);
    } catch (err) {
      log(`⚠️ Response handler error (${region}): ${err.message}`);
    }
  });

  const dashboardUrl = `${baseUrl.replace(/\/$/, "")}/app/`;
  try {
    await page.goto(dashboardUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    const currentUrl = page.url();
    if (/login/i.test(currentUrl)) {
      throw new Error("PowerPlay session expired. Run `npm run cookies:save` to refresh cookies.");
    }
    log(`✅ ${region}: dashboard loaded`);
  } catch (err) {
    log(`❌ ${region}: failed to load dashboard ${err.message}`);
    throw err; // Fail fast to avoid silent 401s later
  }

  // === Force periodic API polling ===
  const POLL_INTERVAL_MS = Number(process.env.PP_POLL_INTERVAL_MS || 30000);
  const pollUrl = `${baseUrl.replace(/\/$/, "")}/app/powerplay3-server/api/OpportunitySummary/Pending/Dealer?PageSize=1000`;

  async function poll() {
    try {
      const res = await page.request.get(pollUrl, { timeout: Math.min(POLL_INTERVAL_MS - 500, 5000) });
      if (res.status() === 401) {
        log(`❌ ${region}: poll returned 401 Unauthorized — cookies/token likely expired`);
        await refreshTokens("poll-401");
        return;
      }
      const json = await res.json().catch(() => null);
      const items = Array.isArray(json?.pagedResults)
        ? json.pagedResults
        : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : [];
      log(`📡 ${region}: polled ${items.length} opportunities`);
      const idx = pollUrl.toLowerCase().indexOf("/api/");
      const apiRoot = idx !== -1 ? pollUrl.slice(0, idx + 5) : `${baseUrl.replace(/\/$/, "")}/powerplay3-server/api/`;
      if (items.length) await handleOpportunityItems(items, apiRoot);
    } catch (err) {
      log(`⚠️ ${region}: poll failed ${err.message}`);
    }
  }

  // fire immediately and schedule loop
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);

  // === Heartbeat ===
  const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 60000);
  setInterval(() => {
    log(`💓 Heartbeat — ${region} monitor alive @ ${new Date().toISOString()}`);
  }, HEARTBEAT_INTERVAL_MS);

  // keep alive
  await new Promise(() => {});
}