import 'dotenv/config';
import { refreshToken } from "../src/auth/tokenRefresher.js";

const envRegions = (process.env.REGIONS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const regions = envRegions.length
  ? envRegions
  : [
      "Central FL",
      "Jacksonville FL",
      "Ft Myers FL",
      "Austin TX",
      "Dallas TX",
    ];

(async () => {
  for (const region of regions) {
    await refreshToken(region);
  }
  console.log("✅ Manual cron refresh complete");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});


