import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

async function loginAndGetBearer(region: string): Promise<string> {
  // TODO: implement real login; placeholder returns existing file if present
  const dir = process.env.COOKIES_DIR ?? '.cookies';
  const tokenFile = path.join(dir, `${region}-token.txt`);
  try {
    const existing = (await fs.readFile(tokenFile, 'utf8')).trim();
    if (existing) return existing;
  } catch {}
  return 'Bearer <jwt>';
}

async function main() {
  const regions = (process.env.REGIONS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const dir = process.env.COOKIES_DIR ?? '.cookies';
  await fs.mkdir(dir, { recursive: true });

  for (const region of regions) {
    const bearer = await loginAndGetBearer(region);
    const tokenFile = path.join(dir, `${region}-token.txt`);
    await fs.writeFile(tokenFile, bearer);
    console.log(`refreshed token for ${region}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


