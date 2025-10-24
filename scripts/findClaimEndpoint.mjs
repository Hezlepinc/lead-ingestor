// scripts/findClaimEndpoint.mjs
import fs from "fs";

const input = process.argv[2] || "./powerplay.generac.com.har";

if (!fs.existsSync(input)) {
  console.error(`❌ HAR file not found: ${input}`);
  process.exit(1);
}

console.log(`📥 Scanning HAR file for 'claim' endpoints...`);
const har = JSON.parse(fs.readFileSync(input, "utf8"));

let matches = [];

for (const entry of har.log.entries) {
  const { request, response } = entry;
  if (!request.url.toLowerCase().includes("claim")) continue;

  matches.push({
    method: request.method,
    url: request.url,
    status: response.status,
    hasBody: !!request.postData,
    body: request.postData?.text?.slice(0, 400) || "",
    headers: request.headers
      .filter(h => ["authorization", "x-xsrf-token", "content-type"].includes(h.name.toLowerCase()))
      .map(h => `${h.name}: ${h.value}`)
      .join("\n"),
  });
}

if (!matches.length) {
  console.log("⚠️ No claim endpoints found in this HAR file.");
  process.exit(0);
}

console.log(`✅ Found ${matches.length} claim calls:\n`);
for (const m of matches) {
  console.log(`🔗 ${m.method} ${m.url} [${m.status}]`);
  if (m.headers) {
    console.log("Headers:");
    console.log(m.headers);
  }
  if (m.body) {
    console.log("Payload:");
    console.log(m.body);
  }
  console.log("—".repeat(60));
}