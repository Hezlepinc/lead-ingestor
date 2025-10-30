import mongoose from 'mongoose';

export async function connectToMongo(uri: string) {
  if (!uri) throw new Error('MONGO_URI missing');
  await mongoose.connect(uri);
}


