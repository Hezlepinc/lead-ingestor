"""
Standalone PowerPlay Lead Claimer
---------------------------------
Runs independently of Node.
Polls the PowerPlay API every 30 seconds for pending leads
and claims them using saved cookies (id_token, access_token).
"""

import requests, time, json, sys, os
from datetime import datetime


# === Configuration ===
REGION = os.getenv("REGION", "Central FL")
POWERPLAY_URL = "https://powerplay.generac.com/app/powerplay3-server/api/OpportunitySummary/Pending/Dealer?PageSize=1000"
CLAIM_URL = "https://powerplay.generac.com/app/powerplay3-server/api/Opportunity/Claim"
COOKIES_PATH = f"./cookies/{REGION.lower().replace(' ', '-')}.json"
POLL_INTERVAL = 30  # seconds


def load_cookies(path=COOKIES_PATH):
    """Load cookies from JSON file exported by Playwright login."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"❌ Missing cookie file: {path}")
    with open(path, "r") as f:
        cookies = {c["name"]: c["value"] for c in json.load(f)}
    return cookies


def get_pending_leads(cookies):
    """Fetch pending PowerPlay leads."""
    r = requests.get(POWERPLAY_URL, cookies=cookies)
    r.raise_for_status()
    data = r.json()
    leads = data.get("data", [])
    return leads


def claim_lead(lead, cookies):
    """Attempt to claim a PowerPlay opportunity."""
    opportunity_id = lead.get("opportunityId")
    if not opportunity_id:
        print("⚠️ Skipping lead with no ID")
        return

    payload = {"opportunityId": opportunity_id}
    r = requests.post(CLAIM_URL, cookies=cookies, json=payload)

    ts = datetime.utcnow().strftime("%H:%M:%S")
    if r.status_code == 200:
        print(f"[{ts}] ✅ Claimed lead {opportunity_id} ({REGION})")
    else:
        print(f"[{ts}] ❌ Failed claim {opportunity_id}: {r.status_code} {r.text[:100]}")


def main():
    print(f"🚀 Starting standalone PowerPlay claimer for {REGION}")
    cookies = load_cookies()

    while True:
        try:
            leads = get_pending_leads(cookies)
            if not leads:
                print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] No pending leads...")
            for lead in leads:
                claim_lead(lead, cookies)
        except Exception as e:
            print(f"⚠️ Error during polling loop: {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()


