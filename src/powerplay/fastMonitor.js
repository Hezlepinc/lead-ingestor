import { request as pwRequest } from "playwright";
import { log } from "../utils/logger.js";
import { Auth } from "../models/Auth.js";
import { claimOpportunity } from "./claimOpportunity.js";
import { TTLSet } from "../utils/ttlCache.js";

/**
 * Region config example:
 * {
 *   name: "Dallas TX",
 *   apiRoot: "https://powerplay.generac.com/app/powerplay3-server/api",
 *   cookieHeader?: "pp-sso=...; XSRF-TOKEN=...",
 *   cookiePath?: "/secrets/dallas.json"
 * }
 */

const DEFAULT_INTERVAL_MS = Number(process.env.PP_POLL_INTERVAL_MS || 1000); // 1s default
const DEFAULT_PAGE_SIZE   = Number(process.env.PP_PAGE_SIZE || 25);          // smaller payload
const JITTER_MS = Number(process.env.PP_POLL_JITTER_MS || 120); // reduce synchronized collisions

export async function startFastMonitors({
  regions,
  intervalMs = DEFAULT_INTERVAL_MS,
  pageSize = DEFAULT_PAGE_SIZE,
}) {
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new Error("startFastMonitors: 'regions' array required");
  }

  // One API client per region (persistent HTTP/2/keep-alive)
  const regionClients = new Map();
  const seenByRegion = new Map(); // regionName -> TTLSet

  // Build each region monitor in parallel
  await Promise.all(regions.map(async (regionCfg) => {
    const apiRoot = regionCfg.apiRoot.replace(/\/$/, "");
    const auth = await Auth.findOne({ region: regionCfg.name }).lean().catch(() => null);

    const extraHTTPHeaders = {
      accept: "application/json, text/plain, */*",
      ...(regionCfg.cookieHeader ? { cookie: regionCfg.cookieHeader } : {}),
      ...(auth?.jwt ? { authorization: `Bearer ${auth.jwt}` } : {}),
      ...(auth?.xsrf ? { "x-xsrf-token": auth.xsrf } : {}),
    };

    const ctx = await pwRequest.newContext({
      baseURL: apiRoot,
      extraHTTPHeaders,
      ignoreHTTPSErrors: true,
      timeout: Math.min(intervalMs - 50, 1500), // keep snappy
    });

    regionClients.set(regionCfg.name, ctx);
    seenByRegion.set(regionCfg.name, new TTLSet());
  }));

  // Start independent timers (no round-robin)
  const timers = regions.map((regionCfg) => {
    const { name, apiRoot } = regionCfg;
    const api = regionClients.get(name);
    const seen = seenByRegion.get(name);

    const tick = async () => {
      const started = Date.now();
      const qs = `?PageSize=${pageSize}`;
      const url = `/OpportunitySummary/Pending/Dealer${qs}`;

      try {
        const res = await api.get(url, {
          headers: { "cache-control": "no-cache" },
          timeout: Math.min(intervalMs - 50, 1400),
        });
        const status = res.status();
        if (status !== 200) {
          log(`⚠️ ${name}: feed ${status}`);
          return;
        }
        const json = await res.json();
        const rows = json?.pagedResults ?? [];
        // Process newest-first to lower "age on first sight"
        rows.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));

        for (const row of rows) {
          const id = row.id;
          if (!id) continue;

          // Fast in-memory gate (avoid DB roundtrips in hot path)
          if (seen.has(id)) continue;

          // Mark as seen immediately to avoid racing our own ticks
          seen.add(id);

          const createdAt = new Date(row.dateCreated).getTime();
          const ageMs = Date.now() - createdAt;

          // If we are already too late, we'll still try once, but log it.
          if (ageMs > 5000) {
            log(`⏱️ ${name}: first seen id=${id} is already ${Math.round(ageMs)} ms old`);
          }

          // Claim ASAP (do not await the poll loop)
          void (async () => {
            const jitter = Math.floor(Math.random() * JITTER_MS); // tiny jitter to avoid synchronized POSTs
            if (jitter) await new Promise(r => setTimeout(r, jitter));

            const { status, ms, error } = await claimOpportunity({
              region: name,
              id,
              apiRoot,
              api,
              cookieHeader: regionCfg.cookieHeader,
              cookiePath: regionCfg.cookiePath,
              extraHeaders: {},
              timeoutMs: 1500,
            });

            if (error) {
              log(`🛑 ${name}: claim ${id} failed: ${error.message}`);
            } else {
              log(`✅ ${name}: claimed ${id} → ${status} (claim=${ms} ms; seenAge=${Math.round(ageMs)} ms)`);
            }
          })();
        }

        const took = Date.now() - started;
        if (took > intervalMs) {
          log(`⚠️ ${name}: poll overran interval (${took} ms > ${intervalMs} ms)`);
        }
      } catch (err) {
        log(`❌ ${name}: poll failed ${err.message}`);
      }
    };

    // Kickoff immediately, then at fixed cadence + jitter
    const initialJitter = Math.floor(Math.random() * JITTER_MS);
    setTimeout(tick, initialJitter);
    const handle = setInterval(tick, intervalMs + Math.floor(Math.random() * JITTER_MS));
    return handle;
  });

  log(`🚀 fast monitors started for ${regions.map(r => r.name).join(", ")} @ ${intervalMs}ms / region`);
  return {
    stop: async () => {
      timers.forEach(clearInterval);
      // Close API contexts
      await Promise.all(Array.from(regionClients.values()).map(ctx => ctx.dispose().catch(() => {})));
      log("🛑 fast monitors stopped");
    }
  };
}


