import fs from "fs/promises";
import path from "path";
import { cfg } from "../config.js";

function toSlug(region) {
  return region.toLowerCase().replace(/\s+/g, "-");
}

export async function getTokenForRegion(region) {
  const base = path.join(cfg.cookiesPath, toSlug(region));
  const tokenPath = `${base}-token.txt`;
  const raw = (await fs.readFile(tokenPath, "utf8")).trim();
  return raw; // may start with "Bearer "; callers can strip if needed
}


