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
const loginUrl = 'https://powerplay.generac.com/'; // adjust if your login page differs

function toSlug(name) {
  return String(name).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function refreshForRegion(region) {
  console.log(`🔐 Refreshing token for ${region.name}...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(loginUrl, { waitUntil: 'networkidle' });

    // Adjust selectors to your PowerPlay login form
    await page.fill('input[name="username"]', region.username);
    await page.fill('input[name="password"]', region.password);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');

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


