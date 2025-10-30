import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const regions = [
  { name: 'Central FL', username: process.env.USER_CENTRAL_FL, password: process.env.PASS_CENTRAL_FL },
  { name: 'Jacksonville FL', username: process.env.USER_JACKSONVILLE_FL, password: process.env.PASS_JACKSONVILLE_FL },
  { name: 'Ft Myers FL', username: process.env.USER_FT_MYERS_FL, password: process.env.PASS_FT_MYERS_FL },
  { name: 'Austin TX', username: process.env.USER_AUSTIN_TX, password: process.env.PASS_AUSTIN_TX },
  { name: 'Dallas TX', username: process.env.USER_DALLAS_TX, password: process.env.PASS_DALLAS_TX },
];

const dir = process.env.COOKIES_PATH || '/opt/render/project/src/cookies';
// Generac PowerPlay now redirects to Auth0 login under id.generac.com
const loginUrl = 'https://powerplay.generac.com/app';

function toSlug(name) {
  return String(name).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function refreshForRegion(region) {
  console.log(`🔐 Refreshing token for ${region.name}...`);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote'
    ]
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    // --- STEP 1: Navigate to Auth0 login ---
    await page.waitForURL("**id.generac.com/u/login/**", { timeout: 30000 }).catch(() => {});
    await page.waitForSelector("#username", { timeout: 25000 });

    // --- STEP 2: Fill email and press Enter ---
    await page.fill("#username", region.username);
    await page.keyboard.press("Enter");

    // --- STEP 3/4: Wait for password field, fill, and submit; on failure, screenshot ---
    try {
      await page.waitForSelector('#password', { timeout: 60000 });
      await page.fill('#password', region.password);
      await page.keyboard.press('Enter');
    } catch (err) {
      console.error(`⚠️  ${region.name}: password screen not found (${err.message})`);
      const safeName = region.name.replace(/\s+/g, '_');
      await page.screenshot({
        path: `/data/auth/${safeName}_after_email.png`,
        fullPage: true,
      });
      await page.screenshot({
        path: `/data/auth/${safeName}_no_password.png`,
        fullPage: true,
      });
      throw err;
    }

    // --- STEP 5: Wait until redirected back to PowerPlay ---
    await page.waitForURL("**powerplay.generac.com/app**", { timeout: 45000 });
    await page.waitForLoadState("networkidle");

    // Pull token directly from Session Storage
    const idToken = await page.evaluate(() => sessionStorage.getItem('id_token'));
    if (!idToken) throw new Error(`No id_token found for ${region.name}`);

    const bearer = `Bearer ${idToken}`;
    const filePath = path.join(dir, `${toSlug(region.name)}-token.txt`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, bearer.trim(), 'utf8');
    console.log(`✅ Updated ${filePath}`);
  } catch (err) {
    console.error(`❌ Failed for ${region.name}: ${err.message}`);
  } finally {
    await browser.close();
  }
}

(async () => {
  for (const region of regions) await refreshForRegion(region);
  console.log('✨ All tokens refreshed');
})();


