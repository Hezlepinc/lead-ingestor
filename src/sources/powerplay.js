import { chromium } from "playwright";
import { sendCustomerEmail, sendOfficeEmail } from "../utils/emailer.js";
import { log } from "../utils/logger.js";
import fs from "fs";

//
// === Render / Playwright runtime fail-safes ===
//
process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/render/project/.cache/ms-playwright";
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD =
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD || "1";

export async function startPowerPlayMonitor({ onLead, url, cookiePath, region }) {
  try {
    log(`⚙️ Launching headless Chromium for ${region || "unnamed region"}...`);
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ],
    });
    const context = await browser.newContext();

    // === Load cookies ===
    if (cookiePath && fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
      await context.addCookies(cookies);
      log(`🍪 Loaded cookies from ${cookiePath}`);
    } else {
      log(`⚠️ No cookies found at ${cookiePath}. You may need to run cookieSaver.js locally.`);
    }

    const page = await context.newPage();
    const baseUrl = url || process.env.POWERPLAY_URLS?.split(",")[0];
    if (!baseUrl)
      throw new Error("POWERPLAY_URLS missing or empty in environment variables.");

    // Navigate to dashboard where claims panel lives
    const trimmed = baseUrl.replace(/\/+$/, "");
    const dashboardUrl = /\/app$/i.test(trimmed) ? `${trimmed}/` : `${trimmed}/app/`;
    log(`🕵️ Monitoring PowerPlay (${region || "region unknown"}) → ${dashboardUrl}`);

    // Navigation moved below so that request/response listeners capture initial traffic

    // =======================================================
    // === Watch for PowerPlay network traffic (main APIs) ===
    // =======================================================
    page.on("request", async (req) => {
      const reqUrl = req.url();
      const method = req.method();
      const headersAll = (req.headers && req.headers()) || {};
      const headers = Object.fromEntries(
        Object.entries(headersAll).filter(([k]) =>
          !/^cookie$|^authorization$/i.test(k)
        )
      );

      // 1️⃣ Claim request (actual claim or accept)
      if ((/\/api\/opportunity\/\d+\/claim/i.test(reqUrl) || /\/api\/.*claim/i.test(reqUrl)) && method === "POST") {
        const rawData = req.postData();
        let data;
        try {
          data = JSON.parse(rawData);
        } catch {
          data = rawData;
        }

        const claimEvent = {
          type: "claim",
          source: "PowerPlay",
          region,
          account: cookiePath,
          url: reqUrl,
          method,
          headers,
          payload: data,
          timestamp: new Date(),
        };

        log(`🚀 Captured Claim Request (${region}):`, claimEvent);

        try {
          if (onLead) await onLead(claimEvent);
          await sendOfficeEmail({ lead: claimEvent, sourceAccount: region || baseUrl });
        } catch (err) {
          log(`❌ Error handling claim for ${region}: ${err.message}`);
        }
        return;
      }

      // 2️⃣ Opportunity Feed (new / search)
      if (/\/api\/opportunit(y|ies|y\/search)/i.test(reqUrl)) {
        const data = req.postData() || null;
        log(`📥 Feed detected (${region}): ${reqUrl}`);
        if (onLead) {
          await onLead({
            type: "feed",
            region,
            url: reqUrl,
            payload: data,
            timestamp: new Date(),
          });
        }
      }

      // 3️⃣ Opportunity Detail (when viewing one)
      if (/\/api\/opportunity\/\d+$/i.test(reqUrl) && method === "GET") {
        log(`📄 Detail request detected (${region}): ${reqUrl}`);
        if (onLead) {
          await onLead({
            type: "detail",
            region,
            url: reqUrl,
            timestamp: new Date(),
          });
        }
      }

      // 4️⃣ Generic API traffic capture (dashboard widgets, etc.)
      if (/\/api\//i.test(reqUrl)) {
        const data = req.postData && req.postData();
        log(`🧲 API detected (${region}): ${method} ${reqUrl}`);
        if (onLead) {
          await onLead({
            type: "api",
            region,
            url: reqUrl,
            method,
            headers,
            payload: data || null,
            timestamp: new Date(),
          });
        }
      }
    });

    // 4️⃣ Capture responses (optional debugging)
    page.on("response", async (res) => {
      try {
        const url = res.url();
        if (/\/api\//i.test(url)) {
          const status = res.status();
          const headers = res.headers ? res.headers() : {};
          const contentType = (headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
          let body = null;
          if (contentType.includes("application/json")) {
            try {
              body = await res.text();
            } catch (e) {
              // Some responses cannot be retrieved; skip body but keep metadata
              log(`⚠️ Skipping body read (${status}) ${url}: ${e.message}`);
              body = null;
            }
          }
          log(`📬 Response (${status}) from ${url}`);
          if (onLead) {
            await onLead({
              type: "response",
              region,
              url,
              status,
              body,
              timestamp: new Date(),
            });
          }
        }
      } catch (err) {
        log(`⚠️ Response handler error: ${err.message}`);
      }
    });

    // === Navigate after listeners are attached ===
    try {
      await page.goto(dashboardUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      log(`✅ Loaded Dashboard page for ${region || "region"}`);
    } catch (err) {
      log(`⚠️ Page navigation failed (${dashboardUrl}): ${err.message}`);
      await browser.close();
      return;
    }

    // =======================================================
    // === TEST MODE (optional local verification) ===========
    // =======================================================
    if (process.env.TEST_MODE === "true") {
      const fakeData = {
        customerName: "Test Customer",
        customerEmail: "testcustomer@example.com",
        customerPhone: "555-000-1234",
        postalCode: "32218",
      };
      const lead = {
        source: "PowerPlay",
        region: region || "Test Region",
        account: cookiePath,
        name: fakeData.customerName,
        email: fakeData.customerEmail,
        phone: fakeData.customerPhone,
        zip: fakeData.postalCode,
        payload: fakeData,
      };

      log(`🧪 TEST: Simulated Opportunity (${region || "region"}):`, lead);

      if (onLead) await onLead(lead);
      await sendOfficeEmail({ lead, sourceAccount: region || baseUrl });

      if (lead.email) {
        await sendCustomerEmail({
          to: lead.email,
          name: lead.name,
          schedulerUrl: `${process.env.SCHEDULER_LINK}${lead.email}`,
        });
      }
      log("✅ TEST: Simulated opportunity processed successfully.");
    }

    // =======================================================
    // === Keep the monitor alive indefinitely ===============
    // =======================================================
    await new Promise(() => {});
  } catch (err) {
    log(`❌ PowerPlay monitor failed to start: ${err.message}`);
  }
}