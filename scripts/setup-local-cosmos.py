"""
Creates the PluckIt database and all required containers in the local
Cosmos DB emulator (vnext-preview, http://localhost:8081), and creates
the Azurite blob containers for uploads and archive.

Usage:
    python3 scripts/setup-local-cosmos.py

Prerequisites:
    - Cosmos DB emulator running: docker start cosmos-emulator
    - Azurite running: azurite --skipApiVersionCheck --location ~/.azurite
    - Azure CLI installed (used for blob container creation)
"""

import base64
import hashlib
import hmac
import json
from json import JSONDecodeError
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import datetime

_HTTP_DATE_FMT = "%a, %d %b %Y %H:%M:%S GMT"
_PK_USER = "/userId"

ENDPOINT = "http://localhost:8081"
COSMOS_KEY = "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b5S5O4FhfJLkfB6NWNFNJ+Mfzq8R7uoB8g=="
DATABASE = "PluckIt"

CONTAINERS = [
    ("Wardrobe",                      _PK_USER),
    ("WardrobeImageCleanupIndex",      "/partition"),
    ("UserProfiles",                  "/id"),
    ("Conversations",                 _PK_USER),
    ("Digests",                       _PK_USER),
    ("Moods",                         "/primaryMood"),
    ("DigestFeedback",                _PK_USER),
    ("WearEvents",                    _PK_USER),
    ("StylingActivity",               _PK_USER),
    ("ScraperSources",                "/id"),
    ("ScrapedItems",                  "/sourceId"),
    ("UserSourceSubscriptions",       _PK_USER),
    ("TasteCalibration",              _PK_USER),
    ("UserBans",                      _PK_USER),
    ("TasteAnalysisJobs",             _PK_USER),
    ("TasteAnalysisJobDeadLetters",   _PK_USER),
    ("RefreshTokens",                 _PK_USER),
]

AZURITE_CONN = "UseDevelopmentStorage=true"
BLOB_CONTAINERS = ["uploads", "archive"]


# ── Cosmos helpers ─────────────────────────────────────────────────────────────


def _parse_response_body(body):
    if not body:
        return ""
    try:
        return json.loads(body)
    except JSONDecodeError:
        return body.decode("utf-8", errors="ignore")


def _cosmos_request(method, path, body=None, resource_type="", resource_id=""):
    date = datetime.datetime.now(datetime.timezone.utc).strftime(_HTTP_DATE_FMT)
    string_to_sign = f"{method.lower()}\n{resource_type.lower()}\n{resource_id}\n{date.lower()}\n\n"
    sig = base64.b64encode(
        hmac.new(base64.b64decode(COSMOS_KEY), string_to_sign.encode("utf-8"), hashlib.sha256).digest()
    ).decode()
    auth = f"type%3Dmaster%26ver%3D1.0%26sig%3D{urllib.parse.quote(sig)}"

    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(ENDPOINT + path, data=data, method=method)
    req.add_header("Authorization", auth)
    req.add_header("x-ms-date", date)
    req.add_header("x-ms-version", "2018-12-31")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, _parse_response_body(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, _parse_response_body(e.read())


def create_database():
    status, body = _cosmos_request("POST", "/dbs", {"id": DATABASE}, resource_type="dbs", resource_id="")
    if status == 201:
        print(f"  Created database '{DATABASE}'")
    elif status == 409:
        print(f"  Database '{DATABASE}' already exists")
    else:
        print(f"  ERROR creating database: {status} {body}")
        raise SystemExit(1)


def create_cosmos_container(name, partition_key):
    status, resp_body = _cosmos_request(
        "POST",
        f"/dbs/{DATABASE}/colls",
        {"id": name, "partitionKey": {"paths": [partition_key], "kind": "Hash"}},
        resource_type="colls",
        resource_id=f"dbs/{DATABASE}",
    )
    if status == 201:
        print(f"  Created container '{name}' (pk: {partition_key})")
    elif status == 409:
        print(f"  Container '{name}' already exists")
    else:
        print(f"  ERROR creating '{name}': {status} {resp_body}")


# ── Azurite helpers ────────────────────────────────────────────────────────────

def create_blob_containers():
    for name in BLOB_CONTAINERS:
        result = subprocess.run(
            [
                "az", "storage", "container", "create",
                "--name", name,
                "--connection-string", AZURITE_CONN,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            created = json.loads(result.stdout).get("created", False)
            if created:
                print(f"  Created blob container '{name}'")
            else:
                print(f"  Blob container '{name}' already exists")
        else:
            print(f"  ERROR creating blob container '{name}': {result.stderr.strip()[:200]}")
            continue

        # Set public-blob access so the app can serve images without SAS tokens.
        # (Azurite doesn't support the SDK's SAS API version in local dev.)
        perm = subprocess.run(
            [
                "az", "storage", "container", "set-permission",
                "--name", name,
                "--public-access", "blob",
                "--connection-string", AZURITE_CONN,
            ],
            capture_output=True,
            text=True,
        )
        if perm.returncode != 0:
            print(f"  WARN: could not set public access on '{name}': {perm.stderr.strip()[:200]}")


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Connecting to Cosmos emulator at {ENDPOINT}...")
    print(f"Creating database '{DATABASE}'...")
    create_database()
    print(f"Creating {len(CONTAINERS)} Cosmos containers...")
    for name, pk in CONTAINERS:
        create_cosmos_container(name, pk)
    print("Creating Azurite blob containers...")
    create_blob_containers()
    print("Done.")
