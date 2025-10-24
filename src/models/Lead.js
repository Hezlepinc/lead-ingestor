import mongoose from "mongoose";

const LeadSchema = new mongoose.Schema({
  source: String,
  account: String,
  name: String,
  email: String,
  phone: String,
  zip: String,
  payload: Object,
  createdAt: { type: Date, default: Date.now }
});

export const Lead = mongoose.model("Lead", LeadSchema);


