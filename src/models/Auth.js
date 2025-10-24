import mongoose from "mongoose";

const AuthSchema = new mongoose.Schema({
  region: { type: String, index: true, unique: true },
  xsrf: { type: String },
  jwt: { type: String },
  updatedAt: { type: Date, default: Date.now },
});

export const Auth = mongoose.model("Auth", AuthSchema);


