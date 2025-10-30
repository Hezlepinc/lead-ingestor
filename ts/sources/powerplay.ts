import { http } from '../lib/http';

export async function listAvailableOpps({ headers }: { region: string; headers: Record<string, string> }) {
  const url = `${process.env.POWERPLAY_API_ROOT}/OpportunitySummary/Pending/Dealer?PageSize=1000`;
  const res = await http.get(url, { headers, timeout: 2000 });
  const data = res.data as any;
  const items: any[] = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data)
    ? data
    : [];
  const oppIds = items.map((x: any) => String(x?.opportunityId || x?.id)).filter(Boolean);
  return oppIds;
}


