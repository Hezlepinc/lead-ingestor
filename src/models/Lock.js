import mongoose from "mongoose";

const LockSchema = new mongoose.Schema({
  _id: { type: String }, // e.g., claim:Region:OpportunityId
  expiresAt: { type: Date, index: true },
});

export const Lock = mongoose.model("Lock", LockSchema);



