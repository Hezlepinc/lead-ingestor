import os
import time
import json
import traceback
import requests
from threading import Thread
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from pymongo import MongoClient, ASCENDING
from bson.objectid import ObjectId

# Optional import; only needed if SignalR mode is enabled
try:
    from signalrcore.hub_connection_builder import HubConnectionBuilder
except Exception:  # pragma: no cover
    HubConnectionBuilder = None

# Prefer secure token service; fallback to static POWERPLAY_ID_TOKEN
from token_client import get_token


# === ENV CONFIG ===
MONGO_URI = os.getenv("MONGODB_URI")
API_ROOT = os.getenv("POWERPLAY_API_ROOT")
JOB_COLLECTION = os.getenv("JOB_COLLECTION", "jobs")
CLAIMS_COLLECTION = os.getenv("CLAIMS_COLLECTION", "claims")
MAX_PARALLEL = int(os.getenv("MAX_PARALLEL_CLAIMS", "5"))
STANDALONE = os.getenv("STANDALONE", "false").lower() == "true"
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))
PENDING_URL = os.getenv(
    "POWERPLAY_PENDING_URL",
    "https://powerplay.generac.com/app/powerplay3-server/api/OpportunitySummary/Pending/Dealer?PageSize=1000",
)
CLAIM_URL_DIRECT = os.getenv(
    "POWERPLAY_CLAIM_URL",
    "https://powerplay.generac.com/app/powerplay3-server/api/Opportunity/Claim",
)
COOKIES_PATH = os.getenv("COOKIES_PATH", f"./cookies/{(os.getenv('REGION', 'Central FL')).lower().replace(' ', '-')}.json")

# SignalR-related (optional)
HUB_URL = os.getenv("POWERPLAY_LEADPOOL_HUB")
DEALER_ID = os.getenv("POWERPLAY_DEALER_ID")
STATIC_ID_TOKEN = os.getenv("POWERPLAY_ID_TOKEN")  # optional fallback
REGION = os.getenv("REGION", "Central FL")
AUTO_CLAIM = os.getenv("AUTO_CLAIM", "false").lower() == "true"


# === DB INIT ===
client = MongoClient(MONGO_URI, maxPoolSize=20)
db = client.get_default_database()

db[CLAIMS_COLLECTION].create_index([("opportunityId", ASCENDING), ("region", ASCENDING)], unique=True)
db[JOB_COLLECTION].create_index([("status", ASCENDING), ("createdAt", ASCENDING)])


def now():
    return datetime.now(timezone.utc)


def bearer(id_token):
    return {"Authorization": f"Bearer {id_token}", "Accept": "application/json", "Content-Type": "application/json"}


def claim_endpoint_a(opportunity_id):
    # Existing endpoint style used by this repo previously
    return f"{API_ROOT}/Opportunity/Claim/{opportunity_id}"


def claim_endpoint_b(opportunity_id):
    # Alternate style some environments use
    return f"{API_ROOT}/Opportunity/{opportunity_id}/Claim"


def fetch_id_token(preferred_region: str) -> str:
    """Get an ID token using the Node token service if available, else fallback to static env."""
    if STATIC_ID_TOKEN:
        return STATIC_ID_TOKEN
    try:
        token, _ = get_token(preferred_region)
        return token
    except Exception as e:
        raise RuntimeError(f"No ID token available (set POWERPLAY_ID_TOKEN or TOKEN_SERVICE_URL/SECRET). {e}")


def try_claim(opportunity_id: str, id_token: str) -> int:
    # Try endpoint A, then fallback to B with body
    try:
        url_a = claim_endpoint_a(opportunity_id)
        r = requests.post(url_a, headers=bearer(id_token), timeout=20)
        if r.status_code in (200, 201, 204):
            return r.status_code
    except Exception:
        pass

    try:
        url_b = claim_endpoint_b(opportunity_id)
        body = {"dealerId": int(DEALER_ID)} if DEALER_ID else {}
        r = requests.post(url_b, headers=bearer(id_token), json=body or None, timeout=20)
        return r.status_code
    except Exception:
        return 0


def load_cookies(path: str) -> dict:
    try:
        with open(path, "r") as f:
            data = json.load(f)
            items = data.get("cookies", data) if isinstance(data, dict) else data
            return {c.get("name"): c.get("value") for c in items}
    except Exception as e:
        raise FileNotFoundError(f"Cookie load failed {path}: {e}")


def get_pending_leads(cookies: dict = None, id_token: str = None):
    headers = {"Accept": "application/json"}
    if id_token:
        headers.update({"Authorization": f"Bearer {id_token}"})
    r = requests.get(PENDING_URL, headers=headers, cookies=cookies or {}, timeout=20)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if isinstance(data.get("pagedResults"), list):
            return data["pagedResults"]
        if isinstance(data.get("data"), list):
            return data["data"]
    return []


def claim_direct(opportunity_id: str, cookies: dict = None, id_token: str = None) -> int:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if id_token:
        headers.update({"Authorization": f"Bearer {id_token}"})
    payload = {"opportunityId": opportunity_id}
    try:
        r = requests.post(CLAIM_URL_DIRECT, headers=headers, cookies=cookies or {}, json=payload, timeout=20)
        return r.status_code
    except Exception:
        return 0


def process_job(job):
    opp = job["payload"]["opportunityId"]
    region = job["payload"]["region"]
    try:
        id_token = fetch_id_token(region)
        code = try_claim(opp, id_token)
        if code in (200, 201, 204):
            db[CLAIMS_COLLECTION].insert_one({
                "opportunityId": opp, "region": region, "status": "success", "ts": now()
            })
            print(f"✅ Claimed {opp} ({region})")
        else:
            print(f"⚠️ Claim failed {opp}: {code}")
    except Exception as e:
        print(f"🟥 Error processing job {opp}: {e}")
    finally:
        db[JOB_COLLECTION].update_one({"_id": ObjectId(job["_id"])}, {"$set": {"status": "done"}})


def mongo_worker_loop():
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
        print("🚀 Python claimer active (Mongo job consumer)...")
        while True:
            jobs = list(db[JOB_COLLECTION].find({"status": "queued"}).limit(MAX_PARALLEL))
            if not jobs:
                time.sleep(1)
                continue
            for job in jobs:
                db[JOB_COLLECTION].update_one({"_id": job["_id"]}, {"$set": {"status": "processing"}})
                pool.submit(process_job, job)


# === Optional: SignalR LeadPool listener ===
def start_signalr_listener():
    if not HUB_URL or HubConnectionBuilder is None:
        print("ℹ️ SignalR mode disabled (missing POWERPLAY_LEADPOOL_HUB or signalrcore)")
        return

    # Append dealerId query if not present
    hub_url = HUB_URL
    if DEALER_ID and "crmDealerId=" not in hub_url:
        sep = "&" if "?" in hub_url else "?"
        hub_url = f"{hub_url}{sep}crmDealerId={DEALER_ID}"

    # Token factory uses secure token service if available; else static env token
    def token_factory():
        try:
            return fetch_id_token(REGION)
        except Exception as e:
            print(f"❌ Token fetch failed: {e}")
            return ""

    print(f"\n🚀 Starting PowerPlay Lead Worker for {REGION}")
    print(f"🔗 HUB: {hub_url}")
    print(f"🔑 Dealer: {DEALER_ID or 'unknown'} | AUTO_CLAIM={AUTO_CLAIM}\n")

    hub = (
        HubConnectionBuilder()
        .with_url(hub_url, options={"access_token_factory": token_factory})
        .configure_logging(lambda level, msg: print(f"[SignalR] {msg}"))
        .build()
    )

    def handle_event(name, data):
        try:
            print(f"\n⚡ EVENT: {name}")
            try:
                print(json.dumps(data, indent=2)[:800])
            except Exception:
                print(str(data)[:800])
            if AUTO_CLAIM and isinstance(data, dict):
                opp_id = (
                    data.get("opportunityId")
                    or data.get("opportunityID")
                    or data.get("OpportunityId")
                )
                if opp_id:
                    try:
                        token = fetch_id_token(REGION)
                        code = try_claim(str(opp_id), token)
                        print(f"🎯 Auto-claim {opp_id} → status {code}")
                    except Exception as e:
                        print(f"❌ Auto-claim failed: {e}")
                else:
                    print("⚠️ No opportunityId found in payload.")
            else:
                print("💤 AUTO_CLAIM disabled or invalid payload.")
        except Exception as e:
            print(f"⚠️ Event handler error: {e}")

    event_names = [
        "LeadAvailable",
        "LeadPoolUpdated",
        "OpportunityAvailable",
        "OpportunityCreated",
        "OpportunityChanged",
        "OpportunitySummaryUpdated",
        "message",
        "receive",
    ]

    for ev in event_names:
        hub.on(ev, lambda data, ev=ev: handle_event(ev, data))

    hub.on_open(lambda: print("🛰️ Connected to LeadPool SignalR"))
    hub.on_close(lambda: print("🔌 Disconnected from SignalR"))
    hub.on_error(lambda data: print(f"💥 SignalR error: {data}"))

    def run():
        hub.start()
        print("🎯 Listening for incoming PowerPlay events...\n")
        try:
            while True:
                time.sleep(10)
        except KeyboardInterrupt:
            print("🧹 Shutting down SignalR...")
            hub.stop()

    Thread(target=run, daemon=True).start()


def standalone_poller_loop():
    print("🚀 Python standalone poller active...")
    cookies = None
    try:
        cookies = load_cookies(COOKIES_PATH)
        print(f"🍪 Cookies loaded from {COOKIES_PATH}")
    except Exception as e:
        print(f"⚠️ No cookies found ({e}). Will try Bearer only.")

    while True:
        try:
            id_token = None
            try:
                id_token = fetch_id_token(REGION)
            except Exception:
                id_token = None

            leads = get_pending_leads(cookies=cookies, id_token=id_token)
            if not leads:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] No pending leads...")
            for item in leads:
                opp = str(item.get("opportunityId") or item.get("id") or "").strip()
                if not opp:
                    continue
                code = 0
                if id_token:
                    # Try API_ROOT claim style first, then direct claim URL
                    code = try_claim(opp, id_token)
                    if code not in (200, 201, 204):
                        code = claim_direct(opp, cookies=cookies, id_token=id_token)
                else:
                    code = claim_direct(opp, cookies=cookies, id_token=None)

                if code in (200, 201, 204):
                    try:
                        db[CLAIMS_COLLECTION].insert_one({
                            "opportunityId": opp,
                            "region": REGION,
                            "status": "success",
                            "ts": now(),
                        })
                    except Exception:
                        pass
                    print(f"✅ Claimed {opp} ({REGION})")
                else:
                    print(f"⚠️ Claim failed {opp}: {code}")
        except Exception as e:
            print(f"⚠️ Standalone loop error: {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    if STANDALONE:
        standalone_poller_loop()
    else:
        # Start optional SignalR listener in background (if configured)
        start_signalr_listener()
        # Always run Mongo job consumer
        mongo_worker_loop()


