// src/monitors/powerplayCapture.js
import fs from "fs";
import path from "path";
import { log } from "../utils/logger.js";
// NOTE: If you don't have a thin events helper, we can fall back to mongoose directly.
// Expecting a helper at ../db/events.js that exports { events } (a collection handle)
let events;
try {
  // Lazy import to avoid breaking if module path differs
  const m = await import("../db/events.js");
  events = m.events;
} catch {
  // Fallback: use mongoose model Event if available
  try {
    const m = await import("../models/Event.js");
    events = {
      insertOne: async (doc) => {
        try { await m.Event.create(doc); } catch {}
      },
    };
  } catch {
    events = { insertOne: async () => {} };
  }
}

/**
 * Watch PowerPlay dashboard and capture the "lead distribution" network traffic.
 * Called for each dealer region (uses same cookies as PowerPlay monitor).
 */
export async function startPowerPlayCapture({ browser, region }) {
  // Prepare auth context from saved cookies/state
  const slugify = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const slug = slugify(region);
  const baseDir = process.env.COOKIES_PATH || process.env.COOKIES_DIR || "/data/auth";
  const cookieFile = path.join(baseDir, `${slug}.json`);
  const storageStateFile = path.join(baseDir, `${slug}.state.json`);
  const tokenFile = path.join(baseDir, `${slug}-token.txt`);

  let context;
  try {
    if (fs.existsSync(storageStateFile)) {
      context = await browser.newContext({ storageState: storageStateFile });
    } else {
      context = await browser.newContext();
      if (fs.existsSync(cookieFile)) {
        const cookies = JSON.parse(fs.readFileSync(cookieFile, "utf8"));
        await context.addCookies(Array.isArray(cookies) ? cookies : (cookies?.cookies || []));
        const count = Array.isArray(cookies) ? cookies.length : (Array.isArray(cookies?.cookies) ? cookies.cookies.length : 0);
        log(`🍪 Loaded ${count} cookies for ${region}`);
      } else {
        log(`⚠️ No cookie file for ${region} at ${cookieFile}`);
      }
    }
  } catch (e) {
    log(`⚠️ ${region}: failed to load cookies/state — ${e.message}`);
    context = await browser.newContext();
  }

  // Inject bearer token if available
  try {
    if (fs.existsSync(tokenFile)) {
      const bearer = (fs.readFileSync(tokenFile, "utf8").trim() || "");
      if (bearer) {
        await context.setExtraHTTPHeaders({ Authorization: bearer });
        const token = bearer.replace(/^Bearer\s+/i, "");
        try {
          await context.addInitScript(({ t }) => { try { localStorage.setItem("token", t); localStorage.setItem("id_token", t); } catch {} }, { t: token });
        } catch {}
      }
    }
  } catch {}

  const page = await context.newPage();

  const baseUrl = "https://powerplay.generac.com/app/";
  log(`🕵️ Opening PowerPlay for ${region} → ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  try {
    const currentUrl = page.url();
    if (/login/i.test(currentUrl)) {
      throw new Error("session not authenticated; login required");
    }
  } catch (e) {
    log(`❌ ${region}: not authenticated — ${e.message}`);
  }

  // --- EARLY WARNING HOOK ---
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/OpportunitySummary/Pending/Dealer")) {
      log(`⚡ ${region}: lead request STARTED → ${url}`);
      // Optionally: trigger custom claim logic here
    }
  });

  // --- CAPTURE FULL PAYLOAD ON COMPLETION ---
  page.on("requestfinished", async (req) => {
    try {
      const url = req.url();
      if (url.includes("/OpportunitySummary/Pending/Dealer")) {
        const res = await req.response();
        const status = res.status();
        const text = await res.text().catch(() => "");
        log(`🎯 ${region}: lead request FINISHED (${status})`);

        if (status === 401) {
          log(`⚠️  ${region}: caught 401 — refreshing token immediately`);
          try {
            const m = await import("../auth/tokenRefresher.js");
            await m.refreshToken(region);
            // Apply new token to this context immediately
            const bearerPath = path.join(baseDir, `${slug}-token.txt`);
            if (fs.existsSync(bearerPath)) {
              const bearer = (fs.readFileSync(bearerPath, "utf8").trim() || "");
              if (bearer) await context.setExtraHTTPHeaders({ Authorization: bearer });
            }
          } catch (e) {
            log(`⚠️  ${region}: immediate token refresh failed: ${e.message}`);
          }
        }

        try {
          const data = JSON.parse(text);
          if (Array.isArray(data) && data.length > 0) {
            log(`📦 ${region}: captured ${data.length} pending opportunities`);
            await events.insertOne({
              ts: new Date(),
              region,
              type: "PendingDealer",
              url,
              status,
              payload: data,
            });
          }
        } catch {
          // ignore JSON parse errors
        }
      }
    } catch {}
  });

  // --- Optional: also capture Claim attempts ---
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/OpportunityClaim/Claim")) {
      log(`🖱️ ${region}: claim request ${req.method()} ${url}`);
      events.insertOne({
        ts: new Date(),
        region,
        type: "ClaimAttempt",
        url,
        method: req.method(),
      });
    }
  });

  log(`✅ ${region}: capture hooks active — waiting for lead traffic`);
}


