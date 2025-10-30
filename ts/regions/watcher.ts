import { logger } from '../lib/logger';
import { getAuthHeadersForRegion } from '../auth/tokens';
import { listAvailableOpps } from '../sources/powerplay';
import { claimOpportunity } from '../claim/claim';
import { recordDetection } from '../store/opportunities';
import { connectEvents } from '../sources/events';

type Args = { region: string; index: number; pollMs: number };

export async function startRegionWatcher({ region, pollMs }: Args) {
  logger.info(`Region watcher start: ${region}`);

  const tryClaim = async (oppId: string) => {
    const t0 = Date.now();
    try {
      const headers = await getAuthHeadersForRegion(region);
      const res = await claimOpportunity({ region, oppId, headers });
      const ms = Date.now() - t0;
      logger.info(`claim_success region=${region} opp=${oppId} ms=${ms} http=${res.status}`);
    } catch (e: any) {
      const ms = Date.now() - t0;
      logger.warn(`claim_failed region=${region} opp=${oppId} ms=${ms} err=${e?.message}`);
    }
  };

  const enableEvents = (process.env.ENABLE_SIGNALR ?? 'true').toLowerCase() !== 'false';
  if (enableEvents) {
    connectEvents({
      region,
      onLead: async (oppId) => {
        logger.info(`event_detected region=${region} opp=${oppId}`);
        await recordDetection({ region, oppId, via: 'event' });
        await tryClaim(oppId);
      },
      onStatus: (st) => logger.info(`events_status region=${region} ${st}`),
      onError: (err) => logger.warn(`events_error region=${region} ${String(err)}`),
    }).catch((err) => logger.warn(`events_connect_failed region=${region} ${String(err)}`));
  }

  const tick = async () => {
    try {
      const headers = await getAuthHeadersForRegion(region);
      const opps = await listAvailableOpps({ region, headers });
      for (const oppId of opps) {
        await recordDetection({ region, oppId, via: 'poll' });
        await tryClaim(oppId);
      }
    } catch (e: any) {
      logger.warn(`poll_error region=${region} ${e?.message}`);
    } finally {
      setTimeout(tick, pollMs);
    }
  };
  setTimeout(tick, pollMs);
}


