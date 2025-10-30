import { spawn } from "child_process";

const regions = (process.env.REGIONS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!regions.length) {
  console.error("❌ No REGIONS provided. Set REGIONS env (comma-separated)");
  process.exit(1);
}

console.log("🔁 Refreshing cookies for regions:", regions.join(", "));

function run(region) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["scripts/cookieSaver.js", "--region", slug(region)], {
      stdio: "inherit",
    });
    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`cookieSaver exit code ${code} for ${region}`));
    });
  });
}

function slug(s) {
  return s.toLowerCase().replace(/\s+/g, "-");
}

(async () => {
  for (const r of regions) {
    console.log(`\n=== ${r} ===`);
    try {
      await run(r);
    } catch (e) {
      console.error(`⚠️ Failed to refresh ${r}:`, e.message);
    }
  }
  console.log("\n✅ Refresh complete");
})();


