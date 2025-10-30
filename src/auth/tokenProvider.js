import fs from "fs/promises";
import path from "path";
import { cfg } from "../config.js";

export async function getRegionToken(region) {
  const base = path.join(cfg.cookiesPath, toSlug(region));

  // Try multiple sources in order of preference
  // 1) Explicit storage dump (from cookieSaver: "-storage.json")
  // 2) Playwright storageState (".state.json")
  // 3) Legacy combined file (".json")
  const candidates = [
    `${base}-storage.json`,
    `${base}.state.json`,
    `${base}.json`,
  ];

  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const data = JSON.parse(raw);
      const token = extractIdToken(data);
      const exp = extractExpiry(data);
      if (token) return { token, exp };
    } catch {}
  }

  throw new Error(`Missing id_token for ${region}`);
}

function toSlug(region) {
  return region.toLowerCase().replace(/\s+/g, "-");
}

function extractIdToken(data) {
  // storage dump format: { localStorage: [{ key, value }], sessionStorage: [...] }
  if (Array.isArray(data.localStorage)) {
    const kv = Object.fromEntries(
      data.localStorage.map((e) => [e.name ?? e.key, e.value])
    );
    if (kv.id_token) return kv.id_token;
    // Fallback: look for token-like value
    const candidate = Object.values(kv).find((v) => typeof v === "string" && /^eyJ/.test(v));
    if (candidate) return candidate;
  }

  // playwright storageState: { origins: [{ localStorage: [{ name, value }] }] }
  if (Array.isArray(data.origins)) {
    for (const o of data.origins) {
      const kv = Object.fromEntries((o.localStorage || []).map((e) => [e.name, e.value]));
      if (kv.id_token) return kv.id_token;
    }
  }

  // legacy combined format
  if (data.id_token) return data.id_token;
  return null;
}

function extractExpiry(data) {
  let exp = Date.now() + 10 * 60 * 1000; // default 10 minutes safety window
  if (Array.isArray(data.localStorage)) {
    const kv = Object.fromEntries(
      data.localStorage.map((e) => [e.name ?? e.key, e.value])
    );
    if (kv.id_token_expires_at) exp = Number(kv.id_token_expires_at);
  }
  if (Array.isArray(data.origins)) {
    for (const o of data.origins) {
      const kv = Object.fromEntries((o.localStorage || []).map((e) => [e.name, e.value]));
      if (kv.id_token_expires_at) {
        exp = Number(kv.id_token_expires_at);
        break;
      }
    }
  }
  if (data.id_token_expires_at) exp = Number(data.id_token_expires_at);
  return exp;
}


