import axios from "axios";
import { config } from "dotenv";

config();

let cachedToken = process.env.POWERPLAY_ID_TOKEN || "";
let lastRefresh = cachedToken ? Date.now() : 0;

export async function getValidToken() {
  const expired = Date.now() - lastRefresh > 50 * 60 * 1000; // 50 minutes
  if (cachedToken && !expired) return cachedToken;

  const refreshToken = process.env.POWERPLAY_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("Missing POWERPLAY_REFRESH_TOKEN env var");

  console.log("🔄 Refreshing PowerPlay token...");
  try {
    const res = await axios.post(
      "https://id.generac.com/oauth/token",
      {
        grant_type: "refresh_token",
        client_id: "HvkeUNeH6BUiZ20WqRRO0GCKuiptA3C7",
        refresh_token: refreshToken,
      },
      { headers: { "Content-Type": "application/json" } }
    );

    cachedToken = res.data?.id_token || res.data?.access_token || "";
    if (!cachedToken) throw new Error("Token refresh response missing id_token/access_token");
    lastRefresh = Date.now();
    console.log("✅ Token refreshed successfully.");
    return cachedToken;
  } catch (err) {
    const detail = err?.response?.data || err?.message || String(err);
    console.error("❌ Token refresh failed:", detail);
    throw err;
  }
}


