import { chromium } from "playwright";
import { sendCustomerEmail, sendOfficeEmail } from "../utils/emailer.js";
import { log } from "../utils/logger.js";

export async function startPowerPlayMonitor({ onLead }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const powerplayUrl = process.env.POWERPLAY_URLS.split(",")[0];
  log(`🕵️ Monitoring PowerPlay → ${powerplayUrl}`);

  await page.goto(powerplayUrl, { waitUntil: "domcontentloaded" });

  page.on("request", async (req) => {
    const url = req.url();
    if (/lead|submit|quote/i.test(url) && req.method() === "POST") {
      const rawData = req.postData();
      let data;
      try { data = JSON.parse(rawData); } catch { data = rawData; }

      const lead = {
        source: "PowerPlay",
        account: powerplayUrl,
        name: data?.name || data?.fullName || "",
        email: data?.email || "",
        phone: data?.phone || "",
        zip: data?.zip || "",
        payload: data
      };

      log("📦 Captured Lead:", lead);

      if (onLead) await onLead(lead);
      await sendOfficeEmail({ lead, sourceAccount: powerplayUrl });

      if (lead.email)
        await sendCustomerEmail({
          to: lead.email,
          name: lead.name,
          schedulerUrl: `${process.env.SCHEDULER_LINK}${lead.email}`
        });
    }
  });

  // keep alive forever
  await new Promise(() => {});
}


