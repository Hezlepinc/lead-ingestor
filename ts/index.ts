import 'dotenv/config';
import { connectToMongo } from './lib/mongo';
import { startRegionWatcher } from './regions/watcher';
import { logger } from './lib/logger';

async function main() {
  await connectToMongo(process.env.MONGO_URI!);

  const regions = (process.env.REGIONS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!regions.length) {
    logger.error('No REGIONS provided');
    process.exit(1);
  }

  const pollMs = Number(process.env.POLL_INTERVAL_MS ?? 1000);
  logger.info(`Booting regions: ${regions.join(', ')} pollMs=${pollMs}`);

  regions.forEach((region, i) => {
    const offset = Math.floor((i * pollMs) / regions.length);
    setTimeout(() => startRegionWatcher({ region, index: i, pollMs }), offset);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


