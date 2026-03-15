# Pluck-It — Quick Start (Local Dev)

This guide gets all three services running locally using emulators — no Azure subscription required.

## Prerequisites

Install these tools before starting:

| Tool | Version | Install |
|---|---|---|
| .NET SDK | 10.x | https://dotnet.microsoft.com/download |
| Azure Functions Core Tools | 4.x | `npm i -g azure-functions-core-tools@4 --unsafe-perm true` |
| Python | 3.12+ | https://python.org or `pyenv install 3.12` |
| Node.js | 20+ | https://nodejs.org |
| Angular CLI | latest | `npm i -g @angular/cli` |
| Azurite (storage emulator) | latest | `npm i -g azurite` |
| Docker | latest | https://docs.docker.com/get-docker/ (for Cosmos emulator on Mac/Linux) |

### Cosmos DB Emulator

**macOS / Linux** — run via Docker:
```bash
docker run -d -p 8081:8081 -p 10251-10254:10251-10254 \
  -e AZURE_COSMOS_EMULATOR_PARTITION_COUNT=3 \
  -e AZURE_COSMOS_EMULATOR_ENABLE_DATA_PERSISTENCE=true \
  --name cosmos-emulator \
  mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:latest
```

**Windows** — download the installer from https://aka.ms/cosmosdb-emulator

Emulator UI (to inspect data): http://localhost:8081/_explorer/index.html

### Azure OpenAI

The AI features (stylist, digest, metadata extraction) require an Azure OpenAI resource with:
- A `gpt-4.1-mini` deployment
- A `text-embedding-3-small` deployment

Ask a team member for the shared dev endpoint and key, then paste them into your `local.settings.json` files.

---

## Setup

### 1. Clone and branch

```bash
git clone https://github.com/<org>/Pluck-It.git
cd Pluck-It
git checkout dev
```

### 2. Configure local settings

Copy the example files and fill in your Azure OpenAI credentials (everything else is pre-filled for local emulators):

```bash
cp PluckIt.Functions/local.settings.json.example PluckIt.Functions/local.settings.json
cp PluckIt.Processor/local.settings.json.example PluckIt.Processor/local.settings.json
```

Edit both files and replace:
- `AI__Endpoint` / `AZURE_OPENAI_ENDPOINT` → your Azure OpenAI endpoint
- `AI__ApiKey` / `AZURE_OPENAI_API_KEY` → your Azure OpenAI key

> `local.settings.json` is gitignored — never commit it.

### 3. Install dependencies

```bash
# Angular
cd PluckIt.Client && npm install && cd ..

# Python (run from repo root)
cd PluckIt.Processor
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd ..

# .NET (restores automatically on first build/run)
dotnet restore
```

---

## Running locally

You need **5 terminal tabs** running simultaneously.

### Tab 1 — Azurite (storage emulator)

```bash
azurite --silent --location ~/.azurite --debug ~/.azurite/debug.log --skipApiVersionCheck
```

Azurite listens on:
- Blob: `http://127.0.0.1:10000`
- Queue: `http://127.0.0.1:10001`
- Table: `http://127.0.0.1:10002`

### Tab 2 — Cosmos DB Emulator

```bash
docker start cosmos-emulator   # if already created; otherwise re-run the docker run command above
```

### Tab 3 — PluckIt.Functions (C# — port 7072)

```bash
cd PluckIt.Functions
func start --port 7072
```

### Tab 4 — PluckIt.Processor (Python — port 7071)

```bash
cd PluckIt.Processor
source .venv/bin/activate   # Windows: .venv\Scripts\activate
func start --port 7071
```

### Tab 5 — PluckIt.Client (Angular — port 4200)

```bash
cd PluckIt.Client
npm start
```

Navigate to http://localhost:4200.

---

## First-run: create Cosmos DB containers and Azurite blobs

With the Cosmos emulator and Azurite both running, execute the setup script (no dependencies — uses only the standard library):

```bash
python3 scripts/setup-local-cosmos.py
```

This creates the `PluckIt` database and all 16 containers with the correct partition keys. It is idempotent — safe to run again if containers already exist.

---

## Auth (local bypass)

Google authentication is bypassed in local dev. The `LOCAL_DEV_USER_ID` value in your `local.settings.json` is used as the authenticated user ID for all requests (default: `local-dev-user`).

---

## Image segmentation (optional)

Background removal uses a Modal.com GPU service. For local dev this is **optional** — image uploads work but backgrounds won't be removed.

To enable it, deploy the segmentation service (see [PluckIt.Segmentation.Modal/](PluckIt.Segmentation.Modal/)) and update `SEGMENTATION_ENDPOINT_URL` and `SEGMENTATION_SHARED_TOKEN` in `PluckIt.Processor/local.settings.json`.

---

## Running tests

```bash
# .NET unit tests
dotnet test

# Python unit tests
cd PluckIt.Processor && source .venv/bin/activate
pytest -m unit

# Angular unit tests
cd PluckIt.Client && npm test

# Angular e2e
cd PluckIt.Client && npm run test:e2e
```

---

## Port reference

| Service | Port |
|---|---|
| Angular dev server | 4200 |
| PluckIt.Functions (C#) | 7072 |
| PluckIt.Processor (Python) | 7071 |
| Azurite Blob | 10000 |
| Azurite Queue | 10001 |
| Cosmos DB Emulator | 8081 |

---

## Project structure

```
Pluck-It/
├── PluckIt.Client/             # Angular 19 frontend
├── PluckIt.Core/               # C# domain models & interfaces
├── PluckIt.Infrastructure/     # C# Cosmos DB repos, BlobSasService
├── PluckIt.Functions/          # C# Azure Functions (wardrobe, auth, collections)
├── PluckIt.Processor/          # Python Azure Functions (AI agents, image processing)
├── PluckIt.Segmentation.Modal/ # Modal.com GPU background removal service
├── PluckIt.Tests/              # .NET test project
├── cosmos-backup/              # Admin scripts for Cosmos export/import
└── infra/                      # Terraform infrastructure
```
