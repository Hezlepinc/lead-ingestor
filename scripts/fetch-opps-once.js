// scripts/fetch-opps-once.js
import fs from "fs/promises";

const REGION = process.argv[2] || "central-fl";
const TOKEN_PATH = `cookies/${REGION}-token.txt`;
const URL = "https://powerplay.generac.com/app/powerplay3-server/api/OpportunitySummary/Pending/Dealer?PageSize=1000";

const main = async () => {
  const token = (await fs.readFile(TOKEN_PATH, "utf8")).trim();
  const res = await fetch(URL, { headers: { Authorization: token } });
  if (res.status === 401) {
    console.error("401 Unauthorized — token likely expired. Re-run scripts/cookieSaver.js.");
    process.exit(1);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  await fs.mkdir("out", { recursive: true });
  await fs.writeFile(`out/${REGION}-pending.json`, JSON.stringify(data, null, 2));
  const count = Array.isArray(data?.pagedResults)
    ? data.pagedResults.length
    : Array.isArray(data?.Items)
    ? data.Items.length
    : 0;
  console.log(`Saved ${count} opportunities → out/${REGION}-pending.json`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


