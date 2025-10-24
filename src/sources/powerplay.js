import { chromium } from "playwright";
import { sendCustomerEmail, sendOfficeEmail } from "../utils/emailer.js";
import { log } from "../utils/logger.js";
import fs from "fs";
import path from "path";
import { Auth } from "../models/Auth.js";
import { Opportunity } from "../models/Opportunity.js";
import { claimOpportunity } from "../processors/claimOpportunity.js";

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
    const page = await context.newPage();

    // --- Auto-validate cookies ---
    try {
      const existingCookies = await context.cookies();
      const expired = existingCookies.some((c) => c.expires && c.expires < Date.now() / 1000);
      if (expired) log(`⚠️ Cookies expired for ${region}`);
    } catch {}

    // === Load cookies ===
    if (cookiePath && fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
      await context.addCookies(cookies);
      log(`🍪 Loaded cookies from ${cookiePath}`);
    } else {
      log(`⚠️ No cookies found at ${cookiePath}. You may need to run cookieSaver.js locally.`);
    }

    // Optional auto-save when login page is detected
    page.on("framenavigated", async (frame) => {
      const fUrl = frame.url();
      if (/(login|signin)/i.test(fUrl)) {
        try {
          const outDir = path.dirname(cookiePath || "cookies/unknown.json");
          const outFile = path.join(outDir, `${(region || "region").toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.json`);
          const state = await context.cookies();
          fs.writeFileSync(outFile, JSON.stringify(state, null, 2));
          log(`🔐 ${region}: login detected, saved new cookies → ${outFile}`);
        } catch (e) {
          log(`⚠️ Failed to save cookies on login for ${region}: ${e.message}`);
        }
      }
    });
    const autoClaimEnabled = process.env.AUTO_CLAIM === "true";
    const baseUrl = url || process.env.POWERPLAY_URLS?.split(",")[0];
    if (!baseUrl)
      throw new Error("POWERPLAY_URLS missing or empty in environment variables.");

    // Helper to extract and persist auth tokens (JWT/XSRF)
    async function captureAndSaveTokens(tag) {
      try {
        const cookiesNow = await context.cookies();
        const xsrf = cookiesNow.find((c) => c.name === "XSRF-TOKEN")?.value || null;
        const jwt = await page.evaluate(() => {
          try {
            return (
              window.localStorage.getItem("token") ||
              window.localStorage.getItem("jwt") ||
              null
            );
          } catch {
            return null;
          }
        });
        if (xsrf || jwt) {
          await Auth.updateOne(
            { region },
            { $set: { xsrf: xsrf || null, jwt: jwt || null, updatedAt: new Date() } },
            { upsert: true }
          );
          log(`🔑 Tokens saved for ${region}${tag ? ` (${tag})` : ""}`);
        }
      } catch (e) {
        log(`⚠️ Token capture failed for ${region}: ${e.message}`);
      }
    }

    // Navigate to dashboard where claims panel lives; also prepare opportunities URL
    const trimmed = baseUrl.replace(/\/+$/, "");
    const appRoot = /\/app$/i.test(trimmed) ? trimmed : `${trimmed}/app`;
    const dashboardUrl = `${appRoot}/`;
    const opportunitiesUrl = `${appRoot}/opportunities`;
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
    function extractOpportunityIdsFromJson(jsonBody) {
      const collected = new Set();
      const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (const item of node) visit(item);
          return;
        }
        const maybeId = node.opportunityId ?? node.opportunityID ?? node.id ?? node.ID;
        if (typeof maybeId === "number" || (typeof maybeId === "string" && /^(\d+)$/.test(maybeId))) {
          collected.add(String(maybeId));
        }
        for (const key of Object.keys(node)) visit(node[key]);
      };
      try { visit(jsonBody); } catch { /* ignore */ }
      return Array.from(collected);
    }

    async function attemptAutoClaim(apiUrl, ids) {
      if (!autoClaimEnabled || !ids.length) return;
      try {
        const idx = apiUrl.toLowerCase().indexOf("/api/");
        if (idx === -1) return;
        const apiRoot = apiUrl.slice(0, idx + 5); // include '/api/'
        // Build Cookie header from current browser context to carry auth/session
        const cookieHeader = (await context.cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        for (const id of ids) {
          const candidates = [
            `${apiRoot}Opportunity/${id}/Claim`,
            `${apiRoot}opportunity/${id}/claim`,
          ];
          for (const claimUrl of candidates) {
            try {
              const resp = await page.request.post(claimUrl, {
                headers: {
                  "content-type": "application/json",
                  "accept": "application/json, text/plain, */*",
                  "referer": dashboardUrl,
                  ...(cookieHeader ? { cookie: cookieHeader } : {}),
                },
                data: {},
              });
              const status = resp.status();
              let text = "";
              try { text = await resp.text(); } catch { /* ignore */ }
              log(`⚡ Auto-claim attempt (${region}) → ${claimUrl} → ${status}`);
              if (onLead) {
                await onLead({
                  type: "claimAttempt",
                  region,
                  url: claimUrl,
                  method: "POST",
                  status,
                  body: text,
                  timestamp: new Date(),
                });
              }
              // If success (2xx), stop trying more candidates for this id
              if (status >= 200 && status < 300) break;
            } catch (err) {
              log(`⚠️ Auto-claim error (${region}) ${claimUrl}: ${err.message}`);
            }
          }
        }
      } catch (err) {
        log(`⚠️ Auto-claim setup error (${region}): ${err.message}`);
      }
    }

    page.on("response", async (res) => {
      try {
        const url = res.url();
        if (/\/api\//i.test(url)) {
          const status = res.status();
          const headers = res.headers ? res.headers() : {};
          const contentType = (headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
          let body = null;
          let parsedJson = null;
          if (contentType.includes("application/json")) {
            try {
              body = await res.text();
              try { parsedJson = JSON.parse(body); } catch { /* keep string */ }
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

          // Special handling for OpportunitySummary feeds to trigger fast claim on unclaimed (E0004)
          try {
            const lowerUrl = url.toLowerCase();
            const isSummarySearch = lowerUrl.includes("/api/opportunitysummary/getbydealerid/search");
            const isSummaryPending = lowerUrl.includes("/api/opportunitysummary/pending/dealer");
            if ((isSummarySearch || isSummaryPending) && parsedJson) {
              const items = Array.isArray(parsedJson?.pagedResults)
                ? parsedJson.pagedResults
                : (Array.isArray(parsedJson?.data) ? parsedJson.data : (Array.isArray(parsedJson) ? parsedJson : []));

              if (items.length) {
                // Compute API root and cookies once
                const idx = url.toLowerCase().indexOf("/api/");
                const apiRoot = idx !== -1 ? url.slice(0, idx + 5) : `${baseUrl.replace(/\/$/, "")}/powerplay3-server/api/`;
                const cookieHeader = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

                for (const opp of items) {
                  const oppId = String(opp.opportunityId || opp.opportunityID || opp.id || "");
                  const statusText = String(opp.status || opp.Status || opp.state || "");
                  if (!oppId) continue;

                  // Persist opportunity document if unseen
                  try {
                    const exists = await Opportunity.findOne({ opportunityId: oppId }).lean();
                    if (!exists) {
                      await Opportunity.create({ opportunityId: oppId, region, raw: opp });
                    }
                  } catch { /* ignore persistence errors here */ }

                  if (statusText === "E0004") {
                    log(`🧲 New unclaimed opportunity detected (${region}): ${oppId}${opp.customerFirstName ? ` for ${opp.customerFirstName} ${opp.customerLastName || ""}` : ""}`);
                    if (autoClaimEnabled) {
                      try {
                        await claimOpportunity({ page, region, id: oppId, apiRoot, cookieHeader });
                      } catch (err) {
                        log(`⚠️ Auto-claim error (${region}) ${oppId}: ${err.message}`);
                      }
                    }
                  }
                }
              }

              // We handled claim attempts from this response; skip generic auto-claim below
              return;
            }
          } catch (e) {
            log(`⚠️ OpportunitySummary handler error (${region}): ${e.message}`);
          }

          // If this looks like an Opportunity feed/response and auto-claim is enabled, try to claim
          if (autoClaimEnabled && /\/api\/opportun/i.test(url) && status >= 200 && status < 300 && parsedJson) {
            const ids = extractOpportunityIdsFromJson(parsedJson);
            if (ids.length) await attemptAutoClaim(url, ids);
          }

      // Persist opportunities and trigger claim for unseen/unclaimed ones (legacy search endpoint)
      if (/\/api\/opportunity\/search/i.test(url) && parsedJson) {
        const items = Array.isArray(parsedJson?.data) ? parsedJson.data : (Array.isArray(parsedJson) ? parsedJson : []);
        if (items.length) {
          const cookieHeader = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
          const idx = url.toLowerCase().indexOf("/api/");
          const apiRoot = idx !== -1 ? url.slice(0, idx + 5) : `${baseUrl.replace(/\/$/, "")}/powerplay3-server/api/`;
          for (const item of items) {
            const id = String(item.opportunityId || item.opportunityID || item.id || "");
            if (!id) continue;
            const exists = await Opportunity.findOne({ opportunityId: id }).lean();
            const statusText = String(item.status || item.Status || item.state || "");
            const isUnclaimed = /unclaimed|available|new/i.test(statusText) || statusText === "";
            if (!exists) {
              await Opportunity.create({ opportunityId: id, region, raw: item });
              if (autoClaimEnabled && isUnclaimed) {
                await claimOpportunity({ page, region, id, apiRoot, cookieHeader });
              }
            }
          }
        }
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
      await captureAndSaveTokens("dashboard");
    } catch (err) {
      log(`⚠️ Page navigation failed (${dashboardUrl}): ${err.message}`);
      await browser.close();
      return;
    }

    // After the dashboard stabilizes, navigate to Opportunities to ensure feed/search traffic fires
    try {
      await page.waitForTimeout(1500);
      await page.goto(opportunitiesUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      log(`✅ Loaded Opportunities page for ${region || "region"}`);
      await captureAndSaveTokens("opportunities");
    } catch (err) {
      log(`⚠️ Secondary navigation failed (${opportunitiesUrl}): ${err.message}`);
    }

    // Optional periodic refresh to tighten detection cycle (if the webapp does not self-poll fast enough)
    const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || "0");
    if (pollIntervalMs > 0) {
      log(`⏱️ Polling enabled for ${region} every ${pollIntervalMs} ms`);
      setInterval(async () => {
        try {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
          log(`🔄 Refreshed Opportunities page for ${region || "region"}`);
        } catch (e) {
          log(`⚠️ Periodic refresh failed (${region || "region"}): ${e.message}`);
        }
      }, pollIntervalMs);
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