// src/auth/tokenRefresher.js
import fs from "fs";
import jwt from "jsonwebtoken";
import { chromium } from "playwright";
import { log } from "../utils/logger.js";

/**
 * Reads JWT from disk and returns its expiration time (Date object)
 */
export function getTokenExpiry(region) {
  try {
    const tokenPath = `/data/auth/${region.toLowerCase().replace(/\s+/g, "-")}-token.txt`;
    const raw = fs.readFileSync(tokenPath, "utf8").trim();
    const token = raw.replace("Bearer ", "");
    const decoded = jwt.decode(token);
    if (!decoded?.exp) throw new Error("Missing exp");
    return new Date(decoded.exp * 1000);
  } catch (err) {
    log(`⚠️  Could not read expiry for ${region}: ${err.message}`);
    return null;
  }
}

/**
 * Logs into PowerPlay silently and refreshes the id_token for a region.
 * Uses existing cookies; no manual login required.
 */
export async function refreshToken(region) {
  try {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
      storageState: `/data/auth/${region.toLowerCase().replace(/\s+/g, "-")}.state.json`,
    });
    const page = await context.newPage();
    await page.goto("https://powerplay.generac.com/app/", { waitUntil: "domcontentloaded", timeout: 60000 });
    const newToken = await page.evaluate(() => localStorage.getItem("id_token"));
    if (newToken && newToken.startsWith("ey")) {
      const outPath = `/data/auth/${region.toLowerCase().replace(/\s+/g, "-")}-token.txt`;
      fs.writeFileSync(outPath, `Bearer ${newToken}`);
      log(`🔑  ${region}: token refreshed successfully`);
    } else {
      log(`⚠️  ${region}: no id_token found during refresh`);
    }
    await browser.close();
  } catch (err) {
    log(`❌  ${region}: token refresh failed: ${err.message}`);
  }
}

/**
 * Automatically schedules refresh ~5 min before expiry.
 * Reschedules itself after each refresh.
 */
export function scheduleTokenRefresh(region) {
  const exp = getTokenExpiry(region);
  if (!exp) {
    log(`⚠️  ${region}: cannot schedule refresh — missing exp`);
    return;
  }
  const refreshAt = exp.getTime() - 5 * 60 * 1000;
  const delay = Math.max(refreshAt - Date.now(), 60 * 1000);
  const mins = Math.round(delay / 60000);
  log(`🕒  ${region}: token valid until ${exp.toISOString()} — will refresh in ${mins} min`);

  setTimeout(async () => {
    await refreshToken(region);
    scheduleTokenRefresh(region); // re-schedule after new token is written
  }, delay);
}


