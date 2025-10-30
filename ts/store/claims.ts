import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    region: String,
    opportunityId: String,
    status: Number,
    latencyMs: Number,
    responseBody: String,
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false }
);

schema.index({ opportunityId: 1, createdAt: 1 });
export const ClaimModel = mongoose.model('Claim', schema);

export async function saveClaimAttempt(doc: {
  region: string;
  opportunityId: string;
  status: number;
  latencyMs: number;
  responseBody?: string;
}) {
  await ClaimModel.create(doc);
}


