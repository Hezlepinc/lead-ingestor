import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { getValidToken } from "./utils/token-manager.js";
import { connectMongo, LeadEvent } from "./utils/mongo.js";

async function start() {
  await connectMongo();

  const dealerId = process.env.POWERPLAY_DEALER_ID || process.env.CRM_DEALER_ID;
  if (!dealerId) throw new Error("Missing POWERPLAY_DEALER_ID env var");

  const hubUrl = `https://powerplay.generac.com/app/lead-pool-service/hubs/leadpool?crmDealerId=${dealerId}`;

  // Prime token to fail fast if refresh is broken
  await getValidToken();

  const connection = new HubConnectionBuilder()
    .withUrl(hubUrl, { accessTokenFactory: async () => await getValidToken() })
    .configureLogging(LogLevel.Information)
    .withAutomaticReconnect()
    .build();

  connection.on("HasAvailableLead", async (data) => {
    try {
      console.log("🟢 HasAvailableLead:", data);
      await LeadEvent.create(data);
    } catch (e) {
      console.error("❌ Failed to persist lead event:", e.message);
    }
  });

  connection.onclose(() => console.log("🔴 SignalR disconnected."));
  connection.onreconnecting(() => console.log("🟡 Reconnecting..."));
  connection.onreconnected(() => console.log("🟢 Reconnected."));

  await connection.start();
  console.log("✅ Connected to PowerPlay LeadPool Hub");
}

start().catch((err) => {
  console.error("❌ Listener failed:", err.message);
  process.exitCode = 1;
});


