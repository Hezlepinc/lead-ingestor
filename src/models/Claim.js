import mongoose from "mongoose";

const ClaimSchema = new mongoose.Schema({
  region: { type: String, index: true },
  opportunityId: { type: String, index: true },
  status: { type: Number },
  latencyMs: { type: Number },
  responseBody: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export const Claim = mongoose.model("Claim", ClaimSchema);


