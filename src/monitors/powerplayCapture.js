// src/monitors/powerplayCapture.js
import fs from "fs";
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
  const context = await browser.newContext();
  const page = await context.newPage();

  const baseUrl = "https://powerplay.generac.com/app/";
  log(`🕵️ Opening PowerPlay for ${region} → ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

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


