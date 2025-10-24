import mongoose from "mongoose";

export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ No MONGO_URI found in environment");
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
  }
}


