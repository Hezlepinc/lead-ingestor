import { logger } from '../lib/logger';
import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr';

type Cb = (oppId: string) => void;

export async function connectEvents(opts: {
  region: string;
  onLead: Cb;
  onStatus?: (s: string) => void;
  onError?: (e: unknown) => void;
}) {
  const hub = process.env.SIGNALR_HUB_URL;
  if (!hub) return;
  const conn = new HubConnectionBuilder()
    .withUrl(hub, {
      transport: HttpTransportType.WebSockets,
      accessTokenFactory: async () => {
        // Expect bearer from token file via Node app (future improvement)
        return '';
      },
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Information)
    .build();

  conn.on('NewLeadForDealer', (payload: any) => {
    const opp = String(payload?.opportunityId || payload?.OpportunityId || '').trim();
    if (opp) opts.onLead(opp);
  });

  await conn.start().then(() => opts.onStatus?.('connected')).catch(opts.onError);
  conn.onclose(() => opts.onStatus?.('disconnected'));
}


