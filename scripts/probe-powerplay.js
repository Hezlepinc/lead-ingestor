import { chromium } from "playwright";
import dotenv from "dotenv";
dotenv.config();

function fmt(ts) { return new Date(ts).toISOString(); }

async function main() {
  const baseUrl = process.env.POWERPLAY_URLS?.split(",")[0];
  const cookiePath = process.env.COOKIES_PATH;
  if (!baseUrl || !cookiePath) {
    console.error("Missing POWERPLAY_URLS or COOKIES_PATH env vars");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  try {
    const fs = await import("fs");
    if (fs.default.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.default.readFileSync(cookiePath, "utf8"));
      await context.addCookies(cookies);
    } else {
      console.warn(`Cookie file missing: ${cookiePath}`);
    }
  } catch {}

  const page = await context.newPage();

  const ws = [];
  const sse = [];
  const others = [];

  page.on("websocket", (wsConn) => {
    ws.push({ url: wsConn.url(), ts: Date.now() });
  });

  page.on("response", async (res) => {
    try {
      const url = res.url();
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      if (ct.includes("text/event-stream") || url.toLowerCase().includes("/event")) {
        sse.push({ url, status: res.status(), ts: Date.now() });
      } else if (/\/signalr\//i.test(url) || /hub\b/i.test(url)) {
        others.push({ url, status: res.status(), ts: Date.now(), note: "signalR-like" });
      }
    } catch {}
  });

  const target = `${baseUrl.replace(/\/$/, "")}/app/`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);

  console.log("=== Probed Endpoints ===");
  if (ws.length) {
    console.log("WebSockets:");
    for (const x of ws) console.log(`- [${fmt(x.ts)}] ${x.url}`);
  } else {
    console.log("WebSockets: none observed");
  }
  if (sse.length) {
    console.log("SSE:");
    for (const x of sse) console.log(`- [${fmt(x.ts)}] ${x.url} (${x.status})`);
  } else {
    console.log("SSE: none observed");
  }
  if (others.length) {
    console.log("Other realtime-ish endpoints:");
    for (const x of others) console.log(`- [${fmt(x.ts)}] ${x.url} (${x.status}) ${x.note || ""}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Probe failed:", err.message);
  process.exit(1);
});


