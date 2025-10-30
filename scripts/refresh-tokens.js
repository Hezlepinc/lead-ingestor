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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    // wait for redirect to Auth0 login
    await page.waitForURL("**id.generac.com/u/login/**", { timeout: 25000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded");

    // fill email
    const emailSel = 'input[name="username"], input[name="email"], input#username';
    await page.waitForSelector(emailSel, { timeout: 20000 });
    await page.fill(emailSel, region.username);

    // Auth0 sometimes has hidden submit buttons; click the visible one only
    const continueButtons = await page.$$('button[type="submit"], button[name="action"], button:has-text("Continue")');
    for (const b of continueButtons) {
      if (await b.isVisible()) {
        await b.click({ force: true });
        break;
      }
    }

    // Wait until password field appears
    const passSel = 'input[name="password"], input#password, input[id*="Password"]';
    await page.waitForSelector(passSel, { timeout: 25000 });
    await page.fill(passSel, region.password);

    // Click visible login/continue button again
    const loginButtons = await page.$$('button[type="submit"], button[name="action"], button:has-text("Continue"), button:has-text("Log in")');
    for (const b of loginButtons) {
      if (await b.isVisible()) {
        await b.click({ force: true });
        break;
      }
    }

    // Wait until redirected back to PowerPlay dashboard
    await page.waitForURL("**powerplay.generac.com/app**", { timeout: 40000 });
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


