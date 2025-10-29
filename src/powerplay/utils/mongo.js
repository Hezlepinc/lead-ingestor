import mongoose from "mongoose";

const LeadEventSchema = new mongoose.Schema(
  {
    type: Number,
    productSegment: Number,
    hasLead: Boolean,
    hasFrontPageLead: Boolean,
    coreProductName: String,
    receivedAt: { type: Date, default: Date.now },
  },
  { collection: "lead_events" }
);

export const LeadEvent = mongoose.models.LeadEvent || mongoose.model("LeadEvent", LeadEventSchema);

export async function connectMongo() {
  if (mongoose.connection.readyState === 1) return;
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGO_URI env var");
  await mongoose.connect(uri, { dbName: "lead_ingestor" });
  console.log("✅ Mongo connected");
}


