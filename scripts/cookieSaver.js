// scripts/cookieSaver.js
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

// === CONFIGURATION ===
const loginUrl = "https://powerplay.generac.com/app/";
const COOKIES_DIR = path.join(process.cwd(), "cookies");

// Ensure cookies folder exists
fs.mkdirSync(COOKIES_DIR, { recursive: true });

// CLI args parsing (supports --region <name> or positional)
function parseArgs(argv) {
  const out = { region: process.env.REGION || "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--region" && argv[i + 1]) {
      out.region = argv[i + 1];
      i++;
    } else if (!a.startsWith("--") && !out.region) {
      out.region = a;
    }
  }
  return out;
}

(async () => {
  console.log("⚙️  PowerPlay Cookie & Token Saver");
  console.log("--------------------------------");
  console.log("This script opens a persistent Chrome profile for manual login.\n");
  console.log("➡️  PowerPlay URL:", loginUrl, "\n");

  const { region: regionName } = parseArgs(process.argv);
  if (!regionName) {
    console.error("❌ Region name missing. Pass --region <name> or set REGION env.");
    process.exit(1);
  }

  const basePath = path.join(COOKIES_DIR, `${regionName}`);
  const cookieFile = `${basePath}.json`;
  const storageDumpFile = `${basePath}-storage.json`;
  const storageStateFile = `${basePath}.state.json`;
  const tokenFile = `${basePath}-token.txt`;
  const userDataDir = path.join(process.cwd(), "profiles", regionName);

  // --- Launch persistent browser context
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--start-maximized", "--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  // Reuse existing tab if present (persistent context may auto-open)
  let page = browser.pages()[0] || (await browser.newPage());
  // Track new tabs and prefer the one that lands on powerplay
  browser.on("page", (p) => {
    try {
      const u = p.url();
      if (u.includes("powerplay.generac.com")) page = p;
    } catch {}
  });

  console.log(`➡️ Opening PowerPlay login page: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  console.log("\n💬 Please log in manually in the opened browser window.");
  console.log("   The script will automatically detect when the app is loaded and proceed.");

  // --- Angular-safe navigation to Opportunities view ---
  console.log("➡️ Navigating to Opportunities page (Angular-safe)...");
  try {
    await page.waitForSelector("body", { timeout: 60000 });
    // Try direct hash URL first
    try {
      await page.goto("https://powerplay.generac.com/app/#/opportunities", { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch {}
    // Fallback: set hash manually
    try {
      await page.evaluate(() => { window.location.hash = "#/opportunities"; });
    } catch {}
    // Final fallback: attempt to click any nav element with Opportunities text
    try {
      await page.click('text=Opportunit', { timeout: 5000 });
    } catch {}
    await page.waitForFunction(
      () => window.location.href.includes("/app/") ||
        window.location.hash.includes("opportunit") ||
        document.querySelector("app-opportunities") ||
        Array.from(document.querySelectorAll("h1,h2,h3,nav,button,a,span")).some(e => e.textContent && e.textContent.toLowerCase().includes("opportunit")),
      { timeout: 300000 } // allow up to 5 minutes for manual login
    );
    console.log("✅ Opportunities view is active.");
  } catch (err) {
    console.warn("⚠️ Could not programmatically open Opportunities:", err.message);
  }

  // --- Attempt to read token directly from browser storage and save ---
  try {
    const directToken = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const tokenKey = keys.find(k => k.toLowerCase() === 'token' || /access|id[_-]?token|auth/.test(k.toLowerCase()));
      let val = '';
      if (tokenKey) val = localStorage.getItem(tokenKey) || '';
      if (!val) {
        const ssKeys = Object.keys(sessionStorage);
        const ssKey = ssKeys.find(k => k.toLowerCase() === 'token' || /access|id[_-]?token|auth/.test(k.toLowerCase()));
        if (ssKey) val = sessionStorage.getItem(ssKey) || '';
      }
      return val || '';
    });
    if (directToken && /^eyJ[A-Za-z0-9_-]+/.test(directToken)) {
      fs.writeFileSync(tokenFile, `Bearer ${directToken}`);
      console.log(`🔑 Saved token from localStorage/sessionStorage → ${tokenFile}`);
    }
  } catch {}

  // --- Detect API / SignalR activity and capture token ---
  console.log("🌐 Waiting for PowerPlay or DealerInsights API activity...");
  let apiDetected = false;
  let bearerToken = null;

  // Capture Authorization header on any relevant API request
  page.on("request", (req) => {
    if (
      req.url().includes("powerplay3-server") ||
      req.url().includes("dealerinsights.generac.com")
    ) {
      const auth = req.headers()["authorization"];
      if (auth && auth.startsWith("Bearer ")) {
        bearerToken = auth;
        console.log("🔑 Captured Authorization header:", bearerToken.substring(0, 60) + "...");
      }
    }
  });

  // Detect REST API responses (either domain)
  const restDetected = page
    .waitForResponse(
      (res) =>
        (res.url().includes("/powerplay3-server/") ||
          res.url().includes("dealerinsights.generac.com")) &&
        res.status() === 200,
      { timeout: 120000 }
    )
    .then(() => {
      console.log("✅ Detected PowerPlay / DealerInsights REST API traffic");
      apiDetected = true;
    })
    .catch(() =>
      console.warn("⚠️ No PowerPlay / DealerInsights REST API traffic detected within 2 minutes.")
    );

  // Detect SignalR websocket activity
  const signalRDetected = new Promise((resolve) => {
    page.on("websocket", (ws) => {
      if (ws.url().includes("powerplay3-server") || ws.url().includes("signalr")) {
        console.log("✅ Detected PowerPlay SignalR connection");
        apiDetected = true;
        resolve(true);
      }
    });
  });

  await Promise.race([signalRDetected, restDetected]);
  if (!apiDetected) console.warn("⚠️ No app traffic detected — session may not be fully loaded.");

  // Wait for network idle before saving
  try {
    await page.waitForLoadState("networkidle", { timeout: 60000 });
  } catch {
    console.log("⏳ Timeout waiting for idle state — continuing anyway.");
  }

  // --- Capture cookies ---
  const cookies = await browser.cookies();

  // --- Capture Local & Session Storage (raw dump) ---
  const storageDump = await page.evaluate(() => {
    const ls = Object.entries(localStorage).map(([k, v]) => ({ key: k, value: v }));
    const ss = Object.entries(sessionStorage).map(([k, v]) => ({ key: k, value: v }));
    return { localStorage: ls, sessionStorage: ss };
  });

  // --- Save Playwright storageState (cookies + origin storage) ---
  const playwrightState = await browser.storageState();

  // --- Save to disk ---
  fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
  fs.writeFileSync(storageDumpFile, JSON.stringify(storageDump, null, 2));
  fs.writeFileSync(storageStateFile, JSON.stringify(playwrightState, null, 2));
  if (bearerToken) {
    fs.writeFileSync(tokenFile, bearerToken);
    console.log(`💾 Saved bearer token to: ${tokenFile}`);
  } else {
    // Heuristic: look for token-like values in localStorage when header was not observed
    const tokenLike = (storageDump.localStorage || [])
      .filter((x) => /token|auth|id_token|access/i.test(x.key) || /^eyJ/.test(String(x.value)));
    if (tokenLike.length) {
      const best = tokenLike.find((t) => /access/i.test(t.key)) || tokenLike[0];
      const val = String(best.value || "");
      if (val.startsWith("eyJ")) {
        fs.writeFileSync(tokenFile, `Bearer ${val}`);
        console.log(`🔑 Saved token-like value to: ${tokenFile} (from ${best.key})`);
      }
    }
  }

  // --- Summary ---
  console.log("\n📋 Capture Summary:");
  const byDomain = cookies.reduce((acc, c) => { acc[c.domain] = (acc[c.domain] || 0) + 1; return acc; }, {});
  for (const d of Object.keys(byDomain)) {
    console.log(`   ${String(byDomain[d]).padStart(2)} cookies from ${d}`);
  }

  const ppCookies = cookies.filter(
    (c) =>
      c.domain.includes("powerplay.generac.com") ||
      c.domain.includes("dealerinsights.generac.com")
  );
  if (ppCookies.length)
    console.log(`✅ Captured ${ppCookies.length} relevant cookies (total ${cookies.length}).`);
  else console.warn("⚠️ No PowerPlay / DealerInsights cookies captured — likely token-only auth.");

  const tokenLike = (storageDump.localStorage || []).filter((x) => x.key.toLowerCase().includes("auth") || x.key.toLowerCase().includes("token"));
  if (tokenLike.length) {
    console.log("\n🔑 Possible tokens found in localStorage:");
    tokenLike.forEach((t) => console.log(`   ${t.key}: ${String(t.value).substring(0, 40)}...`));
  } else if (!bearerToken) {
    console.warn("\n⚠️ No tokens found in storage or headers.");
  }

  await browser.close();
  console.log(`\n💾 Saved files:\n   Cookies: ${cookieFile}\n   StorageState: ${storageStateFile}\n   Storage dump: ${storageDumpFile}${fs.existsSync(tokenFile) ? `\n   Token: ${tokenFile}` : ""}`);
  console.log("\n🎉 Done! Cookies, tokens, and storage data saved for this region.");
})();