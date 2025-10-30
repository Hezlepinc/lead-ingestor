import { http } from '../lib/http';
import { withLock } from '../lib/lock';

type ClaimArgs = { region: string; oppId: string; headers: Record<string, string> };

export async function claimOpportunity({ region, oppId, headers }: ClaimArgs) {
  return withLock(`claim:${oppId}`, 90_000, async () => {
    const urlRoot = process.env.POWERPLAY_API_ROOT!;
    const candidates = [
      `${urlRoot}/Opportunity/${encodeURIComponent(oppId)}/Claim`,
      `${urlRoot}/opportunity/${encodeURIComponent(oppId)}/claim`,
    ];
    let lastErr: any = null;
    const started = Date.now();
    for (const url of candidates) {
      try {
        const res = await http.post(url, null, { headers, timeout: Number(process.env.CLAIM_TIMEOUT_MS ?? 2000) });
        return res;
      } catch (e) {
        lastErr = e;
      }
    }
    const err: any = lastErr || new Error('claim_failed');
    err.latencyMs = Date.now() - started;
    throw err;
  });
}


