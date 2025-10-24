// scripts/export-events.js
import "dotenv/config";
import fs from "fs";
import path from "path";
import { connectDB } from "../src/config/db.js";
import { Event } from "../src/models/Event.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const outIdx = args.findIndex((a) => a === "--out");
  const formatIdx = args.findIndex((a) => a === "--format");
  const typeIdx = args.findIndex((a) => a === "--type"); // comma-separated
  const regionIdx = args.findIndex((a) => a === "--region"); // comma-separated
  const sinceIdx = args.findIndex((a) => a === "--since"); // ISO date
  const untilIdx = args.findIndex((a) => a === "--until"); // ISO date
  const limitIdx = args.findIndex((a) => a === "--limit"); // number
  const onlyOpp = args.includes("--only-opportunity") || args.includes("--opportunity-only");

  const now = new Date();
  const defaultFile = `exports/events-${now.toISOString().replace(/[:.]/g, "-")}.jsonl`;

  return {
    out: outIdx !== -1 ? args[outIdx + 1] : defaultFile,
    format: formatIdx !== -1 ? (args[formatIdx + 1] || "ndjson") : "ndjson",
    type: typeIdx !== -1 ? (args[typeIdx + 1] || "") : "",
    region: regionIdx !== -1 ? (args[regionIdx + 1] || "") : "",
    since: sinceIdx !== -1 ? (args[sinceIdx + 1] || "") : "",
    until: untilIdx !== -1 ? (args[untilIdx + 1] || "") : "",
    limit: limitIdx !== -1 ? Number(args[limitIdx + 1] || "0") : 0,
    onlyOpportunity: onlyOpp,
  };
}

function buildQuery({ type, region, since, until, onlyOpportunity }) {
  const base = {};
  if (type) {
    const types = type.split(",").map((s) => s.trim()).filter(Boolean);
    if (types.length) base.type = { $in: types };
  }
  if (region) {
    const regions = region.split(",").map((s) => s.trim()).filter(Boolean);
    if (regions.length) base.region = { $in: regions };
  }
  if (since || until) {
    base.timestamp = {};
    if (since) base.timestamp.$gte = new Date(since);
    if (until) base.timestamp.$lte = new Date(until);
  }
  if (!onlyOpportunity) return base;

  // Filter to Opportunity-related traffic
  const opportunityUrlRegex = /\/api\/opportun/i; // matches opportunity/opportunities/search
  const orConditions = [
    { type: { $in: ["claim", "feed", "detail"] } },
    { $and: [{ type: "response" }, { url: opportunityUrlRegex }] },
    { $and: [{ type: "api" }, { url: opportunityUrlRegex }] },
  ];

  if (Object.keys(base).length === 0) return { $or: orConditions };
  return { $and: [base, { $or: orConditions }] };
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
    count += 1;
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
    count += 1;
    if (limit && count >= limit) break;
  }
  stream.write("]\n");
  await new Promise((r) => stream.end(r));
  return count;
}

async function main() {
  const args = parseArgs();
  await connectDB();

  const query = buildQuery(args);
  const start = Date.now();
  const exporter = args.format === "json" ? exportJson : exportNdjson;
  const written = await exporter({ out: args.out, query, limit: args.limit });
  const ms = Date.now() - start;
  console.log(`✅ Exported ${written} events to ${args.out} in ${ms}ms`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Export failed:", err.message);
  process.exit(1);
});


