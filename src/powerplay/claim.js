import axios from "axios";
import { getValidToken } from "./utils/token-manager.js";

export async function claimLead(productSegment) {
  const dealer = process.env.POWERPLAY_DEALER_ID || process.env.CRM_DEALER_ID;
  if (!dealer) throw new Error("Missing POWERPLAY_DEALER_ID env var");
  const token = await getValidToken();

  const url = `https://powerplay.generac.com/app/lead-pool-service/api/leadpool/accept/${productSegment}?crmDealerId=${dealer}`;
  console.log("📡 Claiming lead at:", url);
  try {
    const res = await axios.post(
      url,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(`✅ Lead claim response ${res.status}`);
    return res.data;
  } catch (err) {
    console.error("❌ Claim failed:", err?.response?.status, err?.response?.data || err?.message);
    throw err;
  }
}


