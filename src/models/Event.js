import mongoose from "mongoose";

const EventSchema = new mongoose.Schema({
  type: { type: String },
  source: { type: String, default: "PowerPlay" },
  region: { type: String },
  account: { type: String },
  url: { type: String },
  status: { type: Number },
  payload: { type: mongoose.Schema.Types.Mixed },
  body: { type: String },
  timestamp: { type: Date, default: Date.now },
});

// Optional: TTL to prevent unbounded growth (7 days)
try {
  EventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
} catch {}

export const Event = mongoose.model("Event", EventSchema);


