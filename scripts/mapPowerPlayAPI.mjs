// scripts/mapPowerPlayAPI.mjs
import fs from "fs";
import path from "path";

const input = process.argv[2] || "./powerplay.generac.com.har";
const output = "./docs/powerplay-api.md";

if (!fs.existsSync(input)) {
  console.error(`❌ HAR file not found: ${input}`);
  process.exit(1);
}

console.log(`📥 Parsing HAR: ${input}`);
const har = JSON.parse(fs.readFileSync(input, "utf8"));

const calls = har.log.entries
  .filter((e) => e.request.url.includes("powerplay3-server/api/"))
  .map((e) => ({
    method: e.request.method,
    url: new URL(e.request.url).pathname,
    status: e.response.status,
    body: e.request.postData?.text || "",
  }));

// Group by endpoint
const groups = {};
for (const c of calls) {
  const short = c.url.replace(/\/[0-9a-fA-F-]{6,}/g, "/{id}");
  const key = `${c.method} ${short}`;
  if (!groups[key]) groups[key] = { ...c, url: short, count: 0 };
  groups[key].count++;
}

let md = `# PowerPlay Internal API (from HAR)\n\n`;
md += `Extracted ${calls.length} total requests.\n\n`;
md += `| Method | Endpoint | Count | Example Status |\n`;
md += `|--------|-----------|--------|----------------|\n`;
for (const g of Object.values(groups)) {
  md += `| ${g.method} | ${g.url} | ${g.count} | ${g.status} |\n`;
}
md += `\n---\n\n### Sample Payloads (truncated)\n`;
for (const g of Object.values(groups).slice(0, 10)) {
  if (g.body) {
    md += `\n#### ${g.method} ${g.url}\n\`\`\`json\n${g.body.slice(0, 400)}\n\`\`\`\n`;
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, md);
console.log(`✅ API summary saved to ${output}`);


