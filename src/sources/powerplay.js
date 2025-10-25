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
export async function startPowerPlayMonitor({ region, url, cookiePath }) {
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
    log(`🍪 Loaded cookies for ${region}`);
  } else {
    log(`⚠️ No cookie file found for ${region}`);
  }

  const page = await context.newPage();

  // === token refresher ===
  async function refreshTokens(tag) {
    try {
      const cookies = await context.cookies();
      const xsrf = cookies.find((c) => c.name === "XSRF-TOKEN")?.value || null;
      const jwt = await page.evaluate(() => localStorage.getItem("token") || null);
      if (xsrf || jwt) {
        await Auth.updateOne(
          { region },
          { $set: { xsrf, jwt, updatedAt: new Date() } },
          { upsert: true }
        );
        log(`🔑 ${region}: tokens refreshed (${tag})`);
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
    if (!Array.isArray(items)) return;
    const cookieHeader = (await context.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    for (const item of items) {
      const id = String(item.opportunityId || item.id || "");
      if (!id) continue;
      const exists = await Opportunity.findOne({ opportunityId: id }).lean();
      const statusText = String(item.status || item.Status || item.state || "");
      const isUnclaimed =
        /E0004|unclaimed|available|new/i.test(statusText) || !statusText;

      if (!exists && ENABLE_EVENT_COLLECTION)
        await Opportunity.create({ opportunityId: id, region, raw: item });

      if (isUnclaimed) await enqueueClaim({ id, apiRoot, cookieHeader });
    }
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
    log(`✅ ${region}: dashboard loaded`);
  } catch (err) {
    log(`❌ ${region}: failed to load dashboard ${err.message}`);
  }

  // keep alive
  await new Promise(() => {});
}