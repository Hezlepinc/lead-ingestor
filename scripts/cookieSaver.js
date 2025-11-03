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

  // Use slugified filenames to avoid duplicates like "Central FL" vs "central-fl"
  const slugify = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const slug = slugify(regionName);

  const basePath = path.join(COOKIES_DIR, `${slug}`);
  const cookieFile = `${basePath}.json`;
  const storageDumpFile = `${basePath}-storage.json`;
  const storageStateFile = `${basePath}.state.json`;
  const tokenFile = `${basePath}-token.txt`;
  const userDataDir = path.join(process.cwd(), "profiles", regionName);

  // --- Launch persistent browser context
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.RENDER ? true : false,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
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
  // Land directly on the Pending Opportunities page
  const powerplayUrl =
    "https://powerplay.generac.com/app/#/opportunity/opportunitysummary/pending";

  console.log(`➡️ Navigating directly to ${powerplayUrl}`);
  await page.goto(powerplayUrl, { waitUntil: "networkidle", timeout: 90000 });

  // Wait for the Pending/Dealer API call (confirm we hit the lead feed)
  try {
    await page.waitForResponse(
      (res) =>
        res.url().includes("/OpportunitySummary/Pending/Dealer") &&
        res.status() === 200,
      { timeout: 30000 }
    );
    console.log("🎯 PowerPlay lead feed confirmed during login.");
  } catch {
    console.log("⚠️ Did not detect Pending/Dealer request within 30s (may still be okay if no leads).");
  }

  // --- Attempt to read token directly from browser storage and save ---
  try {
    const result = await page.evaluate(() => {
      function findJwtInObject(obj) {
        let match = '';
        const stack = [obj];
        while (stack.length) {
          const cur = stack.pop();
          if (!cur) continue;
          if (typeof cur === 'string' && /^eyJ[A-Za-z0-9_-]+/.test(cur)) return cur;
          if (typeof cur === 'object') {
            for (const k of Object.keys(cur)) {
              const v = cur[k];
              if (typeof v === 'string' && /^eyJ[A-Za-z0-9_-]+/.test(v)) {
                // prefer explicit id/access token fields
                if (/id.?token/i.test(k)) return v;
                match = match || v;
              } else if (v && typeof v === 'object') {
                stack.push(v);
              }
            }
          }
        }
        return match;
      }

      // 1) Direct keys
      const keys = Object.keys(localStorage);
      let val = '';
      const tokenKey = keys.find(k => k.toLowerCase() === 'id_token')
        || keys.find(k => /okta.*token/i.test(k))
        || keys.find(k => /access|id[_-]?token|auth/.test(k.toLowerCase()));
      if (tokenKey) val = localStorage.getItem(tokenKey) || '';

      // 2) Okta token storage blob
      const oktaKeys = ['okta-token-storage', 'okta-token-storage.0'];
      for (const k of oktaKeys) {
        try {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          const fromOkta = findJwtInObject(parsed);
          if (fromOkta) {
            val = fromOkta;
            break;
          }
        } catch {}
      }

      // 3) sessionStorage fallback
      if (!val) {
        const ssKeys = Object.keys(sessionStorage);
        const ssKey = ssKeys.find(k => k.toLowerCase() === 'id_token')
          || ssKeys.find(k => /okta.*token/i.test(k))
          || ssKeys.find(k => /access|id[_-]?token|auth/.test(k.toLowerCase()));
        if (ssKey) val = sessionStorage.getItem(ssKey) || '';
        if (!val) {
          for (const k of ['okta-token-storage', 'okta-token-storage.0']) {
            try {
              const raw = sessionStorage.getItem(k);
              if (!raw) continue;
              const parsed = JSON.parse(raw);
              const fromOkta = findJwtInObject(parsed);
              if (fromOkta) { val = fromOkta; break; }
            } catch {}
          }
        }
      }

      return val || '';
    });
    if (result && /^eyJ[A-Za-z0-9_-]+/.test(result)) {
      fs.writeFileSync(tokenFile, `Bearer ${result}`);
      console.log(`🔑 Saved token from storage blobs → ${tokenFile}`);
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