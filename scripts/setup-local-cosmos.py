"""
Creates the PluckIt database and all required containers in the local
Cosmos DB emulator (vnext-preview, http://localhost:8081).

Usage:
    python3 scripts/setup-local-cosmos.py
"""

import ssl
import urllib.request
import json

ENDPOINT = "http://localhost:8081"
KEY = "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b5S5O4FhfJLkfB6NWNFNJ+Mfzq8R7uoB8Tg=="
DATABASE = "PluckIt"

CONTAINERS = [
    ("Wardrobe",                      "/userId"),
    ("UserProfiles",                  "/userId"),
    ("Conversations",                 "/userId"),
    ("Digests",                       "/userId"),
    ("Moods",                         "/primaryMood"),
    ("DigestFeedback",                "/userId"),
    ("WearEvents",                    "/userId"),
    ("StylingActivity",               "/userId"),
    ("ScraperSources",                "/id"),
    ("ScrapedItems",                  "/sourceId"),
    ("UserSourceSubscriptions",       "/userId"),
    ("TasteCalibration",              "/userId"),
    ("UserBans",                      "/userId"),
    ("TasteAnalysisJobs",             "/userId"),
    ("TasteAnalysisJobDeadLetters",   "/userId"),
    ("RefreshTokens",                 "/userId"),
]


def _auth_header(verb, resource_type, resource_id):
    """
    Generate a basic master-key auth token for the emulator.
    The emulator accepts unsigned tokens with the master key directly.
    """
    import base64, hashlib, hmac, datetime
    date = datetime.datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT")
    string_to_sign = f"{verb.lower()}\n{resource_type.lower()}\n{resource_id}\n{date.lower()}\n\n"
    key_bytes = base64.b64decode(KEY)
    sig = base64.b64encode(
        hmac.new(key_bytes, string_to_sign.encode("utf-8"), hashlib.sha256).digest()
    ).decode()
    token = f"type%3Dmaster%26ver%3D1.0%26sig%3D{urllib.parse.quote(sig)}"
    return token, date


import urllib.parse


def _request(method, path, body=None, resource_type="", resource_id=""):
    import base64, hashlib, hmac, datetime
    date = datetime.datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT")
    string_to_sign = f"{method.lower()}\n{resource_type.lower()}\n{resource_id}\n{date.lower()}\n\n"
    key_bytes = base64.b64decode(KEY)
    sig = base64.b64encode(
        hmac.new(key_bytes, string_to_sign.encode("utf-8"), hashlib.sha256).digest()
    ).decode()
    auth = f"type%3Dmaster%26ver%3D1.0%26sig%3D{urllib.parse.quote(sig)}"

    url = ENDPOINT + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", auth)
    req.add_header("x-ms-date", date)
    req.add_header("x-ms-version", "2018-12-31")
    req.add_header("Content-Type", "application/json")
    if body:
        req.add_header("x-ms-documentdb-partitionkey", "[]")

    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def create_database():
    status, body = _request("POST", "/dbs", {"id": DATABASE}, resource_type="dbs", resource_id="")
    if status == 201:
        print(f"  Created database '{DATABASE}'")
    elif status == 409:
        print(f"  Database '{DATABASE}' already exists")
    else:
        print(f"  ERROR creating database: {status} {body}")
        raise SystemExit(1)


def create_container(name, partition_key):
    resource_id = f"dbs/{DATABASE}"
    path = f"/dbs/{DATABASE}/colls"
    body = {
        "id": name,
        "partitionKey": {"paths": [partition_key], "kind": "Hash"},
    }
    status, resp_body = _request("POST", path, body, resource_type="colls", resource_id=resource_id)
    if status == 201:
        print(f"  Created container '{name}' (pk: {partition_key})")
    elif status == 409:
        print(f"  Container '{name}' already exists")
    else:
        print(f"  ERROR creating '{name}': {status} {resp_body}")


AZURITE_CONN = (
    "DefaultEndpointsProtocol=http;"
    "AccountName=devstoreaccount1;"
    "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OugushZnRUOkvietl3hGys8uqHFht0YhfB7DPm3bkzrEt5PJBKgIfbI=;"
    "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
)
BLOB_CONTAINERS = ["uploads", "archive"]


def create_blob_containers():
    try:
        from azure.storage.blob import BlobServiceClient
    except ImportError:
        print("  SKIP: azure-storage-blob not installed (run: pip install azure-storage-blob)")
        return
    client = BlobServiceClient.from_connection_string(AZURITE_CONN)
    for name in BLOB_CONTAINERS:
        try:
            client.create_container(name)
            print(f"  Created blob container '{name}'")
        except Exception as e:
            if "ContainerAlreadyExists" in str(e):
                print(f"  Blob container '{name}' already exists")
            else:
                print(f"  ERROR creating blob container '{name}': {e}")


if __name__ == "__main__":
    print(f"Connecting to Cosmos emulator at {ENDPOINT}...")
    print(f"Creating database '{DATABASE}'...")
    create_database()
    print(f"Creating {len(CONTAINERS)} Cosmos containers...")
    for name, pk in CONTAINERS:
        create_container(name, pk)
    print("Creating Azurite blob containers...")
    create_blob_containers()
    print("Done.")
