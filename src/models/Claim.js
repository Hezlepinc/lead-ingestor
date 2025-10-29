import mongoose from "mongoose";

const ClaimSchema = new mongoose.Schema({
  region: { type: String, index: true },
  opportunityId: { type: String, index: true },
  status: { type: Number },
  latencyMs: { type: Number },
  responseBody: { type: String },
  createdAt: { type: Date, default: Date.now },
  // Idempotency and tracking (optional fields)
  firstAttemptAt: { type: Date },
  lastAttemptAt: { type: Date },
  lastStatus: { type: Number },
  attemptCount: { type: Number, default: 0 },
});

// Non-unique compound index for fast lookup (unique to be added after de-dupe)
try {
  ClaimSchema.index({ region: 1, opportunityId: 1 });
} catch {}

export const Claim = mongoose.model("Claim", ClaimSchema);


