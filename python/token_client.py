import os
import requests

TOKEN_SERVICE_URL = os.getenv("TOKEN_SERVICE_URL")
TOKEN_SERVICE_SECRET = os.getenv("TOKEN_SERVICE_SECRET")


def get_token(region: str):
    """Fetch a live ID token securely from Node's microservice."""
    resp = requests.get(
        f"{TOKEN_SERVICE_URL}?region={region}&secret={TOKEN_SERVICE_SECRET}",
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["id_token"], data["expires_at"]


