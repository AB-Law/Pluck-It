#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

write_local_settings() {
	local target_path="$1"
	local app_type="$2"

	python3 - "$target_path" "$app_type" <<'PY'
import json
import os
import pathlib
import sys

target = pathlib.Path(sys.argv[1])
app_type = sys.argv[2]

if target.exists():
	print(f"[post-create] local settings already exist at {target}; leaving unchanged")
	raise SystemExit(0)

target.parent.mkdir(parents=True, exist_ok=True)

def pick(*names: str, default: str = "") -> str:
	for name in names:
		value = os.getenv(name)
		if value:
			return value
	return default

azure_webjobs_storage = pick(
	"AZURE_WEBJOBS_STORAGE",
	"AzureWebJobsStorage",
	default="UseDevelopmentStorage=true",
)

if app_type == "dotnet":
	values = {
		"AzureWebJobsStorage": azure_webjobs_storage,
		"FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
		"Cosmos__Endpoint": pick("COSMOS_ENDPOINT", "AZURE_COSMOS_ENDPOINT", "Cosmos__Endpoint"),
		"Cosmos__Key": pick("COSMOS_KEY", "AZURE_COSMOS_KEY", "Cosmos__Key"),
		"Cosmos__Database": pick("COSMOS_DATABASE", "Cosmos__Database", default="PluckIt"),
		"Cosmos__Container": pick("COSMOS_CONTAINER", "Cosmos__Container", default="Wardrobe"),
		"AI__Endpoint": pick("AZURE_OPENAI_ENDPOINT", "AI__Endpoint"),
		"AI__ApiKey": pick("AZURE_OPENAI_API_KEY", "AI__ApiKey"),
		"AI__Deployment": pick("AZURE_OPENAI_DEPLOYMENT", "AI__Deployment", default="gpt-4.1-mini"),
		"AI__VisionDeployment": pick("AZURE_OPENAI_VISION_DEPLOYMENT", "AI__VisionDeployment", default="gpt-4.1-mini"),
		"BlobStorage__AccountName": pick("STORAGE_ACCOUNT_NAME", "AZURE_STORAGE_ACCOUNT_NAME", "BlobStorage__AccountName"),
		"BlobStorage__AccountKey": pick("STORAGE_ACCOUNT_KEY", "AZURE_STORAGE_ACCOUNT_KEY", "BlobStorage__AccountKey"),
		"BlobStorage__ArchiveContainer": pick("ARCHIVE_CONTAINER", "BlobStorage__ArchiveContainer", default="archive"),
	}
elif app_type == "python":
	values = {
		"AzureWebJobsStorage": azure_webjobs_storage,
		"FUNCTIONS_WORKER_RUNTIME": "python",
		"COSMOS_DB_ENDPOINT": pick("COSMOS_ENDPOINT", "AZURE_COSMOS_ENDPOINT", "COSMOS_DB_ENDPOINT"),
		"COSMOS_DB_KEY": pick("COSMOS_KEY", "AZURE_COSMOS_KEY", "COSMOS_DB_KEY"),
		"COSMOS_DB_DATABASE": pick("COSMOS_DATABASE", "COSMOS_DB_DATABASE", default="PluckIt"),
		"COSMOS_DB_CONTAINER": pick("COSMOS_CONTAINER", "COSMOS_DB_CONTAINER", default="Wardrobe"),
		"STORAGE_ACCOUNT_NAME": pick("STORAGE_ACCOUNT_NAME", "AZURE_STORAGE_ACCOUNT_NAME"),
		"STORAGE_ACCOUNT_KEY": pick("STORAGE_ACCOUNT_KEY", "AZURE_STORAGE_ACCOUNT_KEY"),
		"UPLOAD_CONTAINER": pick("UPLOAD_CONTAINER", default="uploads"),
		"ARCHIVE_CONTAINER": pick("ARCHIVE_CONTAINER", default="archive"),
	}
else:
	raise ValueError(f"Unknown app_type: {app_type}")

payload = {
	"IsEncrypted": False,
	"Values": values,
}

target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(f"[post-create] wrote {target}")

if azure_webjobs_storage == "UseDevelopmentStorage=true":
	print("[post-create] warning: AzureWebJobsStorage is placeholder; set AZURE_WEBJOBS_STORAGE Codespaces secret for full Functions runtime support")
PY
}

echo "[post-create] Restoring .NET solution"
dotnet restore "$ROOT_DIR/PluckIt.sln"

echo "[post-create] Installing Angular dependencies"
cd "$ROOT_DIR/PluckIt.Client"
npm ci

echo "[post-create] Creating Python virtual environment and installing processor dependencies"
cd "$ROOT_DIR/PluckIt.Processor"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
deactivate

echo "[post-create] Installing Azure Functions Core Tools (func)"
if ! command -v func >/dev/null 2>&1; then
	npm install -g azure-functions-core-tools@4 --unsafe-perm true
fi

echo "[post-create] Writing local Functions settings from environment (if files are missing)"
write_local_settings "$ROOT_DIR/PluckIt.Functions/local.settings.json" "dotnet"
write_local_settings "$ROOT_DIR/PluckIt.Processor/local.settings.json" "python"

echo "[post-create] Tooling versions"
az version | head -n 1 || true
terraform version | head -n 1 || true
func --version || true

echo "[post-create] Setup complete"
