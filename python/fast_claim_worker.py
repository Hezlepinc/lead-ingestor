import os, time, requests
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from pymongo import MongoClient, ASCENDING
from bson.objectid import ObjectId
from token_client import get_token

MONGO_URI = os.getenv("MONGODB_URI")
API_ROOT = os.getenv("POWERPLAY_API_ROOT")
JOB_COLLECTION = os.getenv("JOB_COLLECTION", "jobs")
CLAIMS_COLLECTION = os.getenv("CLAIMS_COLLECTION", "claims")
MAX_PARALLEL = int(os.getenv("MAX_PARALLEL_CLAIMS", "5"))

client = MongoClient(MONGO_URI, maxPoolSize=20)
db = client.get_default_database()

db[CLAIMS_COLLECTION].create_index([("opportunityId", ASCENDING), ("region", ASCENDING)], unique=True)
db[JOB_COLLECTION].create_index([("status", ASCENDING), ("createdAt", ASCENDING)])


def now():
    return datetime.now(timezone.utc)


def bearer(id_token):
    return {"Authorization": f"Bearer {id_token}", "Accept": "application/json"}


def claim_endpoint(opportunity_id):
    return f"{API_ROOT}/Opportunity/Claim/{opportunity_id}"


def process_job(job):
    opp = job["payload"]["opportunityId"]
    region = job["payload"]["region"]
    try:
        id_token, exp = get_token(region)
        url = claim_endpoint(opp)
        r = requests.post(url, headers=bearer(id_token), timeout=20)
        if r.status_code in (200, 201, 204):
            db[CLAIMS_COLLECTION].insert_one({
                "opportunityId": opp, "region": region, "status": "success", "ts": now()
            })
            print(f"✅ Claimed {opp} ({region})")
        else:
            print(f"⚠️ Claim failed {opp}: {r.status_code}")
    except Exception as e:
        print(f"🟥 Error processing job {opp}: {e}")
    finally:
        db[JOB_COLLECTION].update_one({"_id": ObjectId(job["_id"])}, {"$set": {"status": "done"}})


def main_loop():
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
        print("🚀 Python claimer active...")
        while True:
            jobs = list(db[JOB_COLLECTION].find({"status": "queued"}).limit(MAX_PARALLEL))
            if not jobs:
                time.sleep(1)
                continue
            for job in jobs:
                db[JOB_COLLECTION].update_one({"_id": job["_id"]}, {"$set": {"status": "processing"}})
                pool.submit(process_job, job)


if __name__ == "__main__":
    main_loop()


