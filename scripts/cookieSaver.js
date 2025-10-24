// scripts/cookieSaver.js
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import readline from "readline";

// === CONFIGURATION ===
const loginUrl = "https://powerplay.generac.com/app/";
const COOKIES_DIR = path.join(process.cwd(), "cookies");

// Make sure cookies folder exists
fs.mkdirSync(COOKIES_DIR, { recursive: true });

// Simple helper for console prompts
const ask = (question) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
};

(async () => {
  console.log("⚙️  PowerPlay Cookie Saver");
  console.log("--------------------------");
  console.log("This script will open a browser window for login.\n");
  console.log("➡️  Default PowerPlay URL:", loginUrl);
  console.log();

  // Ask for region name
  const regionName = await ask(
    "Enter region name (example: central-fl, jacksonville-fl, ft-myers-fl, austin-tx, dallas-tx):"
  );

  if (!regionName) {
    console.error("❌ Region name cannot be empty. Exiting...");
    process.exit(1);
  }

  const cookieFile = path.join(COOKIES_DIR, `${regionName}.json`);

  // Launch visible browser
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`➡️ Opening PowerPlay login page: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  console.log("\n💬 Please log in manually in the opened browser window.");
  console.log("   After the dashboard loads completely, return here and press ENTER.");
  await ask("Press ENTER once logged in and dashboard is visible... ");

  // Capture cookies
  const cookies = await context.cookies();
  fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
  console.log(`✅ Cookies saved successfully to: ${cookieFile}`);

  await browser.close();
  console.log("\n🎉 Done! You can now upload this cookie file to Render or commit to your private repo.");
})();