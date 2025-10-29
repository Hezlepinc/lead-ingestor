// scripts/export-events.js
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { Event } from "../src/models/Event.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const outIdx = args.findIndex((a) => a === "--out");
  const formatIdx = args.findIndex((a) => a === "--format");
  const typeIdx = args.findIndex((a) => a === "--type");
  const regionIdx = args.findIndex((a) => a === "--region");
  const sinceIdx = args.findIndex((a) => a === "--since");
  const untilIdx = args.findIndex((a) => a === "--until");
  const limitIdx = args.findIndex((a) => a === "--limit");
  const onlyOpp = args.includes("--only-opportunity") || args.includes("--opportunity-only");

  const now = new Date();
  const defaultFile = `out/events-${now.toISOString().replace(/[:.]/g, "-")}.jsonl`;

  // default 24-hour window
  const defaultSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  return {
    out: outIdx !== -1 ? args[outIdx + 1] : defaultFile,
    format: formatIdx !== -1 ? args[formatIdx + 1] || "ndjson" : "ndjson",
    type: typeIdx !== -1 ? args[typeIdx + 1] || "" : "",
    region: regionIdx !== -1 ? args[regionIdx + 1] || "" : "",
    since: sinceIdx !== -1 ? args[sinceIdx + 1] : defaultSince,
    until: untilIdx !== -1 ? args[untilIdx + 1] || "" : "",
    limit: limitIdx !== -1 ? Number(args[limitIdx + 1] || "0") : 0,
    onlyOpportunity: onlyOpp,
  };
}

function buildQuery({ type, region, since, until, onlyOpportunity }) {
  const base = {};
  if (type) base.type = { $in: type.split(",").map((s) => s.trim()).filter(Boolean) };
  if (region) base.region = { $in: region.split(",").map((s) => s.trim()).filter(Boolean) };
  if (since || until) {
    base.timestamp = {};
    if (since) base.timestamp.$gte = new Date(since);
    if (until) base.timestamp.$lte = new Date(until);
  }
  if (!onlyOpportunity) return base;

  const opportunityUrlRegex = /\/api\/opportun/i;
  const orConditions = [
    { type: { $in: ["claim", "feed", "detail"] } },
    { $and: [{ type: "response" }, { url: opportunityUrlRegex }] },
    { $and: [{ type: "api" }, { url: opportunityUrlRegex }] },
  ];
  return Object.keys(base).length === 0
    ? { $or: orConditions }
    : { $and: [base, { $or: orConditions }] };
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
}

async function exportNdjson({ out, query, limit }) {
  await ensureDir(out);
  const stream = fs.createWriteStream(out, { encoding: "utf8" });
  const cursor = Event.find(query).sort({ timestamp: 1 }).lean().cursor();
  let count = 0;
  for await (const doc of cursor) {
    stream.write(JSON.stringify(doc) + "\n");
    count++;
    if (limit && count >= limit) break;
  }
  await new Promise((r) => stream.end(r));
  return count;
}

async function exportJson({ out, query, limit }) {
  await ensureDir(out);
  const stream = fs.createWriteStream(out, { encoding: "utf8" });
  stream.write("[");
  const cursor = Event.find(query).sort({ timestamp: 1 }).lean().cursor();
  let first = true;
  let count = 0;
  for await (const doc of cursor) {
    if (!first) stream.write(",\n");
    stream.write(JSON.stringify(doc));
    first = false;
    count++;
    if (limit && count >= limit) break;
  }
  stream.write("]\n");
  await new Promise((r) => stream.end(r));
  return count;
}

async function main() {
  const args = parseArgs();

  // --- connect directly to test DB
  const uri = process.env.MONGODB_URI.replace(/\/lead-ingestor/i, "/test");
  console.log(`🔌 Connecting to MongoDB (test DB) ...`);
  await mongoose.connect(uri);
  console.log(`✅ Connected to MongoDB (test)`);

  const query = buildQuery(args);
  const exporter = args.format === "json" ? exportJson : exportNdjson;
  const start = Date.now();
  const written = await exporter({ out: args.out, query, limit: args.limit });
  const ms = Date.now() - start;

  console.log(`✅ Exported ${written} events to ${args.out} in ${ms} ms`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Export failed:", err);
  process.exit(1);
});