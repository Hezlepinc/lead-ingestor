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

export const Event = mongoose.model("Event", EventSchema);


