import { HubConnectionBuilder, HttpTransportType, LogLevel } from "@microsoft/signalr";
import { cfg } from "../config.js";
import { enqueueClaimJob } from "../queue/mongoQueue.js";
import { log, warn } from "../logger.js";
import { getRegionToken } from "../auth/tokenProvider.js";

export async function startSignalR(region) {
  const connection = new HubConnectionBuilder()
    .withUrl(cfg.signalRHubUrl, {
      accessTokenFactory: async () => (await getRegionToken(region)).token,
      transport: HttpTransportType.WebSockets,
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Information)
    .build();

  connection.on("NewLeadForDealer", async (payload) => {
    const opp = payload?.opportunityId || payload?.OpportunityId;
    if (opp) await enqueueClaimJob({ opportunityId: opp, region });
    log(`⚡ SignalR NewLead event for ${region}: opp=${opp}`);
  });

  connection.onreconnected(() => log(`🔄 SignalR reconnected (${region})`));
  connection.onclose((e) => warn(`🛑 SignalR closed (${region})`, e?.message));

  await connection.start();
  log(`✅ SignalR connected for ${region}`);
}


