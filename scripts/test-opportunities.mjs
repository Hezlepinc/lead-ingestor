// scripts/test-opportunities.mjs
import { chromium } from "playwright";
import fs from "fs";

const REGION = process.argv[2] || "central-fl";
const STATE_PATH = `cookies/${REGION}.state.json`;

if (!fs.existsSync(STATE_PATH)) {
  console.error(`Missing storage state: ${STATE_PATH}`);
  process.exit(1);
}

const URL = "https://powerplay.generac.com/app/#/opportunities";
const API = "https://powerplay.generac.com/app/powerplay3-server/api/OpportunitySummary/Pending/Dealer?PageSize=1000";

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STATE_PATH });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async (api) => {
    const r = await fetch(api, { credentials: "include" });
    const t = await r.text();
    try {
      return { status: r.status, json: JSON.parse(t) };
    } catch {
      return { status: r.status, text: t };
    }
  }, API);

  console.log("Status:", result.status);
  if (result.json) {
    const list = Array.isArray(result.json?.pagedResults)
      ? result.json.pagedResults
      : Array.isArray(result.json?.Items)
      ? result.json.Items
      : [];
    console.log("Opportunities:", list.length);
  } else {
    console.log(result.text?.slice(0, 200));
  }

  await browser.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


