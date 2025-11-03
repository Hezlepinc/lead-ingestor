// scripts/check-cookies.js
// Simple utility to inspect saved Playwright cookies and token file
import fs from "fs";
import path from "path";

function toISO(secs) {
  if (!secs || Number.isNaN(Number(secs))) return "session";
  try {
    return new Date(Number(secs) * 1000).toISOString();
  } catch {
    return String(secs);
  }
}

function readCookies(file) {
  const raw = fs.readFileSync(file, "utf8");
  const json = JSON.parse(raw);
  const arr = Array.isArray(json) ? json : Array.isArray(json?.cookies) ? json.cookies : [];
  return arr;
}

function findTokenFile(cookieFile) {
  const base = path.basename(cookieFile, ".json");
  const dir = path.dirname(cookieFile);
  return path.join(dir, `${base}-token.txt`);
}

function inspectFile(cookieFile) {
  try {
    const cookies = readCookies(cookieFile);
    console.log(`\n📄 ${cookieFile}`);
    console.log(`   ${cookies.length} cookies`);
    const interesting = cookies
      .filter((c) => /token|xsrf|auth|aspnet/i.test(c.name))
      .sort((a, b) => (a.expires || 0) - (b.expires || 0));
    for (const c of interesting) {
      const exp = toISO(c.expires);
      console.log(`   - ${c.name} @ ${c.domain || ""}  expires=${exp}`);
    }

    const tokenFile = findTokenFile(cookieFile);
    if (fs.existsSync(tokenFile)) {
      const token = fs.readFileSync(tokenFile, "utf8").trim();
      const preview = token ? token.slice(0, 24) + "…" : "<empty>";
      console.log(`   🔑 token: ${preview}`);
    } else {
      console.log("   🔑 token: <missing>");
    }
  } catch (e) {
    console.error(`   ❌ Failed to read ${cookieFile}: ${e.message}`);
  }
}

function main() {
  const fromArg = process.argv.find((a) => a.startsWith("--path="));
  const explicit = fromArg ? fromArg.split("=")[1] : null;
  const envPath = process.env.COOKIES_PATH || process.env.COOKIES_DIR || "./cookies";
  const target = explicit || envPath;

  if (!fs.existsSync(target)) {
    console.error(`❌ Path not found: ${target}`);
    process.exit(1);
  }

  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const files = fs
      .readdirSync(target)
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .map((f) => path.join(target, f));
    if (!files.length) {
      console.log("(no .json cookie files found)");
      return;
    }
    for (const f of files) inspectFile(f);
  } else {
    inspectFile(target);
  }
}

main();


