import "dotenv/config";
import path from "path";
import fs from "fs";
import { connectDB } from "./config/db.js";
import { Lead } from "./models/Lead.js";
import { Opportunity } from "./models/Opportunity.js";
import { startPowerPlayMonitor } from "./sources/powerplay.js";
import { log } from "./utils/logger.js";

(async () => {
  const __dirname = path.resolve();

  // --- Normalize env vars ---
  const COOKIES_PATH =
    process.env.COOKIES_PATH && !path.isAbsolute(process.env.COOKIES_PATH)
      ? path.join(__dirname, process.env.COOKIES_PATH)
      : process.env.COOKIES_PATH || path.join(__dirname, "cookies");

  const POWERPLAY_URLS = (process.env.POWERPLAY_URLS || process.env.POWERPLAY_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const REGION_NAMES = (process.env.REGIONS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // --- Log cookies path ---
  log(`🍪 Cookies path resolved to: ${COOKIES_PATH}`);
  if (!fs.existsSync(COOKIES_PATH)) log(`⚠️ Cookies path missing: ${COOKIES_PATH}`);

  // --- Connect Mongo ---
  await connectDB();

  // ============================================================
  // === Lead & Opportunity Handler (Events Disabled) ============
  // ============================================================
  const handleLead = async (data) => {
    try {
      // 1️⃣ Handle PowerPlay opportunities separately
      if (data?.type === "opportunity") {
        const id = data.id || data.Id || data.opportunityId;
        if (!id) {
          log(`⚠️ Skipping opportunity with no ID (${data.region || "unknown region"})`);
          return;
        }

        // Check if this opportunity already exists
        const existing = await Opportunity.findOne({ powerplayId: id });
        if (existing) {
          // Already seen — just update metadata
          await Opportunity.updateOne(
            { powerplayId: id },
            {
              $set: {
                raw: data,
                lastSeen: new Date(),
                region: data.region || existing.region,
                source: data.source || existing.source,
              },
            }
          );
          log(`🔁 Updated existing opportunity ${id} (${data.region})`);
          return;
        }

        // Otherwise, create a brand-new record
        await Opportunity.create({
          raw: data,
          region: data.region,
          source: data.source || "powerplay",
          powerplayId: id,
          lastSeen: new Date(),
        });

        log(`💾 New opportunity saved → ${id} (${data.region})`);
        return;
      }

      // 2️⃣ Handle normal Leads (non-opportunity payloads)
      const isLikelyLead = Boolean(
        data?.email || data?.phone || data?.name || data?.payload?.customerEmail
      );

      if (isLikelyLead) {
        await Lead.create(data);
        log(`💾 Lead saved → ${data.email || data.phone || data.name || "unknown"}`);
      } else {
        // 🚫 Skip saving events to conserve space
        log(
          `🪶 Skipped event → ${data.type || "generic"} ${
            data.region ? "(" + data.region + ")" : ""
          }`
        );
      }
    } catch (err) {
      log("❌ Failed to persist data:", err.message);
    }
  };

  // --- Helper to slugify region names ---
  const slugify = (s) =>
    s
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

  // --- Resolve cookie file list ---
  let cookieFiles = [];
  if (COOKIES_PATH.includes(",")) {
    cookieFiles = COOKIES_PATH.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (/\.json$/i.test(COOKIES_PATH)) {
    cookieFiles = [COOKIES_PATH];
  } else if (REGION_NAMES.length) {
    cookieFiles = REGION_NAMES.map((r) => path.join(COOKIES_PATH, `${slugify(r)}.json`));
  } else {
    cookieFiles = [COOKIES_PATH];
  }

  // --- Match region names to cookie files ---
  let regionsForRun = [];
  if (REGION_NAMES.length === cookieFiles.length) {
    regionsForRun = REGION_NAMES;
  } else if (REGION_NAMES.length && cookieFiles.length) {
    regionsForRun = cookieFiles.map((_, i) => REGION_NAMES[i] || `Dealer ${i + 1}`);
  } else {
    regionsForRun = cookieFiles.map(
      (f, i) => path.basename(f, ".json") || `Dealer ${i + 1}`
    );
  }

  // --- Startup summary ---
  log(`🚀 Starting monitors for ${cookieFiles.length} dealer accounts...`);

  // --- Helper: Validate token before launching region ---
  const validateToken = (cookiePath, region) => {
    const base = path.basename(cookiePath, ".json");
    const dir = path.dirname(cookiePath);
    const tokenFile = path.join(dir, `${base}-token.txt`);
    if (!fs.existsSync(tokenFile)) {
      log(`⚠️ No token file found for ${region}: ${tokenFile}`);
      return false;
    }
    const token = fs.readFileSync(tokenFile, "utf8").trim();
    if (!token || !token.startsWith("Bearer ")) {
      log(`⚠️ Invalid or empty token for ${region}`);
      return false;
    }
    return true;
  };

  // --- Launch each region sequentially ---
  for (let i = 0; i < cookieFiles.length; i++) {
    const url = POWERPLAY_URLS[i] || POWERPLAY_URLS[0];
    const cookiePath = cookieFiles[i];
    const region = regionsForRun[i] || `Dealer ${i + 1}`;

    if (!fs.existsSync(cookiePath)) {
      log(`⚠️ Missing cookie file for ${region}: ${cookiePath}`);
      continue;
    }

    const hasToken = validateToken(cookiePath, region);
    if (!hasToken) {
      log(`⏸️ Skipping ${region} until valid token exists. Retrying in 60 seconds...`);
      await new Promise((r) => setTimeout(r, 60_000));
      continue;
    }

    log(`🧭 Initializing monitor for ${region} using ${cookiePath}`);
    log(`🕵️ Monitoring PowerPlay (${region}) → ${url}`);

    try {
      startPowerPlayMonitor({ onLead: handleLead, url, cookiePath, region });
    } catch (err) {
      log(`❌ Failed to start monitor for ${region}: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 1000)); // small stagger
  }
})();