import fs from 'node:fs/promises';
import path from 'node:path';

export async function getAuthHeadersForRegion(region: string) {
  const dir = process.env.COOKIES_DIR ?? '.cookies';
  const tokenFile = path.join(dir, `${region}-token.txt`);
  const bearer = (await fs.readFile(tokenFile, 'utf8')).trim();
  if (!bearer.toLowerCase().startsWith('bearer')) {
    throw new Error(`Invalid token for ${region}`);
  }
  return {
    authorization: bearer,
    'content-type': 'application/json',
  };
}


