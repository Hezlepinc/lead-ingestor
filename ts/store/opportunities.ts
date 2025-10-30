import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    region: String,
    opportunityId: String,
    via: String,
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false }
);

schema.index({ opportunityId: 1 }, { unique: false });
export const OppModel = mongoose.model('Opportunity', schema);

export async function recordDetection({ region, oppId, via }: { region: string; oppId: string; via: 'event' | 'poll' }) {
  await OppModel.create({ region, opportunityId: oppId, via });
}


