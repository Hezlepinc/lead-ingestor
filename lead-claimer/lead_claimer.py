"""
Standalone PowerPlay Lead Claimer
---------------------------------
Runs independently of Node.
Polls the PowerPlay API every 30 seconds for pending leads
and claims them using saved cookies (id_token, access_token).
"""

import requests, time, json, sys, os
from datetime import datetime
from typing import Dict, Any, List
try:
    from pymongo import MongoClient
except Exception:
    MongoClient = None


# === Configuration ===
REGION = os.getenv("REGION", "Central FL")
POWERPLAY_URL = os.getenv(
    "POWERPLAY_PENDING_URL",
    "https://powerplay.generac.com/app/powerplay3-server/api/OpportunitySummary/Pending/Dealer?PageSize=1000",
)
CLAIM_URL = os.getenv(
    "POWERPLAY_CLAIM_URL",
    "https://powerplay.generac.com/app/powerplay3-server/api/Opportunity/Claim",
)
COOKIES_PATH = os.getenv(
    "COOKIES_PATH",
    f"./cookies/{REGION.lower().replace(' ', '-')}.json",
)
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))  # seconds
MONGODB_URI = os.getenv("MONGODB_URI", "")
CLAIMS_COLLECTION = os.getenv("CLAIMS_COLLECTION", "claims")
EVENT_COLLECTION = os.getenv("EVENT_COLLECTION", "events")


def load_cookies(path: str = COOKIES_PATH) -> Dict[str, str]:
    """Load cookies from JSON file exported by Playwright login."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"❌ Missing cookie file: {path}")
    with open(path, "r") as f:
        data = json.load(f)
        # accept array-of-cookies or { cookies: [...] } formats
        items = data.get("cookies", data) if isinstance(data, dict) else data
        cookies = {c["name"]: c["value"] for c in items}
    return cookies


def get_pending_leads(cookies: Dict[str, str]) -> List[Dict[str, Any]]:
    """Fetch pending PowerPlay leads."""
    r = requests.get(POWERPLAY_URL, cookies=cookies)
    r.raise_for_status()
    data = r.json()
    # support multiple shapes
    leads = (
        data.get("pagedResults")
        if isinstance(data, dict) and isinstance(data.get("pagedResults"), list)
        else data.get("data", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
    )
    return leads


def claim_lead(lead: Dict[str, Any], cookies: Dict[str, str], mongo=None):
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
        if mongo:
            try:
                mongo[CLAIMS_COLLECTION].insert_one({
                    "opportunityId": str(opportunity_id),
                    "region": REGION,
                    "status": "success",
                    "ts": datetime.utcnow(),
                    "raw": {"response": r.text[:200]},
                })
            except Exception:
                pass
    else:
        print(f"[{ts}] ❌ Failed claim {opportunity_id}: {r.status_code} {r.text[:100]}")
        if mongo:
            try:
                mongo[CLAIMS_COLLECTION].insert_one({
                    "opportunityId": str(opportunity_id),
                    "region": REGION,
                    "status": f"fail:{r.status_code}",
                    "ts": datetime.utcnow(),
                    "raw": {"response": r.text[:200]},
                })
            except Exception:
                pass


def main():
    print(f"🚀 Starting standalone PowerPlay claimer for {REGION}")
    print(f"📡 Pending URL: {POWERPLAY_URL}")
    print(f"🎯 Claim URL: {CLAIM_URL}")
    print(f"🍪 Cookies: {COOKIES_PATH}")

    cookies = load_cookies()

    mongo = None
    if MONGODB_URI and MongoClient is not None:
        try:
            mongo = MongoClient(MONGODB_URI, maxPoolSize=5).get_default_database()
            print("🗄️ Mongo logging enabled")
        except Exception as e:
            print(f"⚠️ Mongo connect failed: {e}")
            mongo = None

    while True:
        try:
            leads = get_pending_leads(cookies)
            if not leads:
                print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] No pending leads...")
                if mongo:
                    try:
                        mongo[EVENT_COLLECTION].insert_one({
                            "type": "heartbeat",
                            "region": REGION,
                            "ts": datetime.utcnow(),
                            "pendingCount": 0,
                        })
                    except Exception:
                        pass
            for lead in leads:
                claim_lead(lead, cookies, mongo)
        except Exception as e:
            print(f"⚠️ Error during polling loop: {e}")
            if mongo:
                try:
                    mongo[EVENT_COLLECTION].insert_one({
                        "type": "error",
                        "region": REGION,
                        "ts": datetime.utcnow(),
                        "message": str(e)[:300],
                    })
                except Exception:
                    pass
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()


