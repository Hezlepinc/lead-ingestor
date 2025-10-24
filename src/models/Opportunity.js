import mongoose from "mongoose";

const OpportunitySchema = new mongoose.Schema({
  opportunityId: { type: String, index: true, unique: true },
  region: { type: String },
  raw: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

export const Opportunity = mongoose.model("Opportunity", OpportunitySchema);


