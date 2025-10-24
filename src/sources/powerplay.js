import { chromium } from "playwright";
import { sendCustomerEmail, sendOfficeEmail } from "../utils/emailer.js";
import { log } from "../utils/logger.js";
import fs from "fs";

//
// === Render / Playwright runtime fail-safes ===
// These keep Chromium working inside Render containers.
//
process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/render/project/.cache/ms-playwright";
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD =
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD || "1";

export async function startPowerPlayMonitor({ onLead, url, cookiePath, region }) {
  try {
    log(`⚙️ Launching headless Chromium for ${region || "unnamed region"}...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    // === Load cookies if available ===
    if (cookiePath && fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
      await context.addCookies(cookies);
      log(`🍪 Loaded cookies from ${cookiePath}`);
    } else {
      log(`⚠️ No cookies found at ${cookiePath}. You may need to run cookieSaver.js locally.`);
    }

    const page = await context.newPage();
    const baseUrl = url || process.env.POWERPLAY_URLS?.split(",")[0];
    if (!baseUrl) throw new Error("POWERPLAY_URLS missing or empty in environment variables.");

    const opportunitiesUrl = `${baseUrl.replace(/\/$/, "")}/opportunities`;
    log(`🕵️ Monitoring PowerPlay (${region || "region unknown"}) → ${opportunitiesUrl}`);

    // === Defensive navigation ===
    try {
      await page.goto(opportunitiesUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      log(`✅ Loaded Opportunities page for ${region || "region"}`);
    } catch (err) {
      log(`⚠️ Page navigation failed (${opportunitiesUrl}): ${err.message}`);
      await browser.close();
      return;
    }

    // === Watch for background network traffic ===
    page.on("request", async (req) => {
      const reqUrl = req.url();
      // Match PowerPlay's Opportunity / Lead / Quote APIs
      if (/opportunit|lead|submit|quote/i.test(reqUrl) && req.method() === "POST") {
        const rawData = req.postData();
        let data;
        try {
          data = JSON.parse(rawData);
        } catch {
          data = rawData;
        }

        const lead = {
          source: "PowerPlay",
          region: region || "unknown",
          account: cookiePath,
          name: data?.name || data?.customerName || "",
          email: data?.email || data?.customerEmail || "",
          phone: data?.phone || data?.customerPhone || "",
          zip: data?.zip || data?.postalCode || "",
          payload: data,
        };

        log(`📦 Captured Opportunity (${region || "region"}):`, lead);

        try {
          if (onLead) await onLead(lead);
          await sendOfficeEmail({ lead, sourceAccount: region || baseUrl });

          if (lead.email) {
            await sendCustomerEmail({
              to: lead.email,
              name: lead.name,
              schedulerUrl: `${process.env.SCHEDULER_LINK}${lead.email}`,
            });
          }
        } catch (err) {
          log(`❌ Error handling lead for ${region || "region"}: ${err.message}`);
        }
      }
    });

    // === Keep alive indefinitely ===
    await new Promise(() => {});
  } catch (err) {
    log(`❌ PowerPlay monitor failed to start: ${err.message}`);
  }
}