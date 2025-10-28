import os, time, threading, requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

MONGO = MongoClient(os.getenv("MONGODB_URI"))
db = MONGO.get_default_database()
API_ROOT = os.getenv("POWERPLAY_API_ROOT")
MAX_PARALLEL = int(os.getenv("MAX_PARALLEL_CLAIMS", "5"))


def get_headers(region):
    auth = db.Auth.find_one({"region": region})
    if not auth:
        return None
    cookies = []
    if auth.get("xsrf"):
        cookies.append(f"XSRF-TOKEN={auth['xsrf']}")
    return {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
        "authorization": f"Bearer {auth.get('jwt','')}",
        "cookie": "; ".join(cookies),
        "referer": "https://powerplay.generac.com/",
    }


def claim(region, opp_id, headers):
    url = f"{API_ROOT}/Opportunity/{opp_id}/Claim"
    try:
        start = time.time()
        res = requests.post(url, headers=headers, timeout=3)
        latency = round((time.time() - start) * 1000)
        db.Claim.insert_one(
            {
                "region": region,
                "opportunityId": str(opp_id),
                "status": res.status_code,
                "latencyMs": latency,
                "createdAt": time.time(),
            }
        )
        print(f"⚡ {region} → {opp_id} → {res.status_code} ({latency} ms)")
    except Exception as e:
        print(f"❌ {region} → {opp_id} failed {e}")


def scan_and_claim(region):
    headers = get_headers(region)
    if not headers:
        return
    try:
        r = requests.get(
            f"{API_ROOT}/OpportunitySummary/Pending/Dealer?PageSize=25",
            headers=headers,
            timeout=3,
        )
        data = r.json()
        items = data.get("pagedResults", [])
        for item in items:
            status = str(item.get("status") or "").lower()
            if "e0004" in status or "unclaimed" in status:
                claim(region, item["id"], headers)
    except Exception as e:
        print(f"⚠️ {region}: poll error {e}")


def worker(region):
    while True:
        scan_and_claim(region)
        time.sleep(5)


if __name__ == "__main__":
    regions = [a["region"] for a in db.Auth.find()]
    print(f"🚀 Fast-claim worker started for: {regions}")
    for region in regions:
        threading.Thread(target=worker, args=(region,), daemon=True).start()
    while True:
        time.sleep(60)


