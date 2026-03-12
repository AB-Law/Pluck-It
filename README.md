# PluckIt — AI-Powered Digital Wardrobe

**PluckIt** is a digital wardrobe application that lets you catalogue your clothing, track wear history, and receive AI-driven outfit suggestions from a personal stylist agent. It is fully deployed to Azure.

---

## Features

| Feature | Status | Description |
|---|---|---|
| Digital Closet | Live | Upload clothing photos, auto-remove backgrounds, tag & categorise items |
| Wardrobe Collections | Live | Group items into named collections; invite other users to join |
| AI Stylist Chat | Live | Streaming GPT-4.1-mini ReAct agent with wardrobe awareness and real-time weather |
| Vault Insights | Live | Cost-per-wear analytics and wardrobe value breakdown |
| Wardrobe Digest | Live | Weekly AI-generated purchase suggestions with thumbs-up/down feedback loop |
| Fashion Mood Trends | Live | Daily trend extraction from RSS feeds, canonicalised via embeddings |
| Wear History | Live | Full wear-event ledger per item with timeline view |
| Conversation Memory | Live | Rolling summary of stylist conversations auto-expires after 30 days |
| Background Removal | Live | BiRefNet transformer model (GPU, Modal) replaces rembg for production quality |
| Google Auth | Live | Google Identity Services sign-in; ID tokens validated in-process on the API |
| Dashboard | Live | Summary stats, recent wear events, digest highlights |
| Profile Management | Live | User preferences, body measurements, style tags |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser — Angular 19+ SPA                                        │
│  pluckit.omakashay.com  (Azure Static Web Apps — Free tier)      │
└─────────────────────────────────┬────────────────────────────────┘
                                  │ HTTPS + Bearer token (Google ID)
          ┌───────────────────────┴───────────────────────┐
          │                                               │
┌─────────▼──────────────┐              ┌────────────────▼────────────────┐
│  .NET 10 Functions     │              │  Python 3.12 Functions          │
│  (Flex Consumption)    │              │  (Flex Consumption + FastAPI)   │
│  pluckit-prod-api-func │              │  pluckit-prod-processor-func    │
│                        │              │                                  │
│  WardrobeFunctions     │  Storage     │  POST /api/process-image        │
│  CollectionFunctions   │  Queue ─────►│  POST /api/chat (SSE)           │
│  StylistFunctions      │              │  GET  /api/digest/latest        │
│  UserProfileFunctions  │              │  GET  /api/insights/vault       │
│  CleanupFunctions      │              │  GET  /api/moods                │
└────────────┬───────────┘              └────────────────┬────────────────┘
             │                                           │
             │                                 ┌─────────▼────────────┐
             │                                 │  Modal.com (GPU)     │
             │                                 │  BiRefNet Segmenter  │
             │                                 │  Scales to zero      │
             │                                 └──────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────┐
│  Azure Services (PluckIt-RG, West Europe)                         │
│  Cosmos DB (Free Tier) · Blob Storage LRS · App Insights          │
└──────────────────────────────────────────────────────────────────┘
```

### Project Layout

```
PluckIt.Core/           # Domain entities & interfaces — zero external dependencies
PluckIt.Infrastructure/ # Implements Core interfaces (Cosmos DB, Blob, OpenAI)
PluckIt.Functions/      # .NET 10 Azure Functions — HTTP triggers, composition root
PluckIt.Processor/      # Python 3.12 Azure Functions — image processing, AI agents
PluckIt.Client/         # Angular 19+ SPA — standalone components, signals
PluckIt.Segmentation.Modal/ # BiRefNet background removal — deployed to Modal.com
PluckIt.Tests/          # xUnit unit & integration tests
infra/                  # All Azure infrastructure as Terraform
.github/workflows/      # CI/CD pipelines
```

### Clean Architecture Rules

- `PluckIt.Core` has **no external dependencies** — it defines the domain model and interfaces only.
- `PluckIt.Infrastructure` implements those interfaces using Azure SDKs (Cosmos DB SDK, Blob Storage, Azure OpenAI).
- `PluckIt.Functions` and `PluckIt.Processor` are the **composition roots** — they wire DI and expose HTTP endpoints.

---

## Technology Choices & Rationale

### Frontend — Angular 19+ with Standalone Components & Signals

Angular 19's standalone component model eliminates NgModules entirely, reducing boilerplate and making lazy-loading trivial. Angular Signals replace RxJS for local reactive state — they are synchronous, easier to reason about, and produce smaller bundles. The app is hosted on **Azure Static Web Apps Free tier** ($0/month), which handles global CDN distribution and custom domains automatically.

### Backend API — .NET 10 Azure Functions (Flex Consumption)

Azure Functions Flex Consumption (FC1) is a true pay-per-execution serverless tier — there are no always-ready instances by default and no minimum hourly charge. For a workload with sporadic traffic this saves ~$50–60/month compared to a dedicated App Service or always-ready Functions plan. Native AOT compilation and source-generated JSON serialization (`PluckItJsonContext`) keep cold-start latency low (~2–5 s) and reduce memory footprint.

### Python Processor — FastAPI ASGI on Azure Functions

The Python processor uses the Azure Functions v2 programming model with a **FastAPI ASGI app** mounted inside it. This gives true Server-Sent Events (SSE) for the AI stylist chat stream — something the standard Functions HTTP trigger cannot do natively. Non-HTTP triggers (queue, timer) remain as standard Function decorators on the same `AsgiFunctionApp`.

### AI — GPT-4.1-mini via Azure OpenAI

GPT-4.1-mini was chosen over GPT-4o for cost efficiency: ~20× cheaper per token while delivering strong instruction-following, function-calling, and code generation. For this workload (outfit suggestions, gap analysis, digest generation) the quality difference is negligible. The LangGraph `create_react_agent` loop gives the stylist access to live wardrobe data, weather, user profile, and trend moods via typed tools.

### Background Removal — BiRefNet on Modal.com

The original `rembg` (U2Net) model ran inside the Azure Function itself, bundling a 176 MB ONNX file with every deployment. It also produced mediocre results on complex garments. **BiRefNet** (a transformer-based salient object detector) running on a GPU produces significantly cleaner cutouts with fine-grained edge detail. Modal.com was chosen because:

- **Scales to zero** — GPU container is only billed during actual inference (~1–3 s per image).
- **Model weights are cached** in a Modal Volume, eliminating download time on cold starts.
- **No GPU quota required on Azure** — keeping the Azure subscription in the free/low-cost zone.
- **Simple deployment** — `modal deploy modal_app.py` from CI; the endpoint is a plain HTTPS URL.

The Azure Processor calls the Modal endpoint synchronously after the queue trigger fires, writes the cutout PNG to Blob Storage, and updates the Cosmos DB item record.

### Database — Azure Cosmos DB NoSQL (Free Tier)

Cosmos DB NoSQL was selected for its schema-less documents (clothing items evolve frequently), partition-based scaling, and generous free tier: **1,000 RU/s throughput + 25 GB storage at $0/month**. Shared throughput across all containers means adding new containers (e.g. Moods, DigestFeedback) does not increase the bill. Composite indexes covering each sort dimension are defined in Terraform to avoid cross-partition queries and keep RU consumption within the free allocation.

### Infrastructure — Terraform on Azure

All Azure resources are defined in `infra/` and managed exclusively via Terraform. This gives:

- **Reproducibility** — the entire environment can be torn down and recreated in minutes.
- **Drift detection** — `terraform plan` on every PR catches accidental manual changes.
- **Auditability** — resource configuration lives in version control alongside application code.

Remote state is stored in Azure Blob Storage so CI and local developers share the same state file. Sensitive values (API keys, connection strings) are injected via `terraform.auto.tfvars` at CI time and never hardcoded.

---

## Cost Summary

| Resource | SKU / Tier | Est. Monthly Cost |
|---|---|---|
| Azure Static Web Apps | Free | $0 |
| Cosmos DB (all containers) | Free tier (1,000 RU/s, 25 GB) | $0 |
| Azure Functions — API | Flex Consumption FC1, no always-ready | ~$0–2 (pay-per-call) |
| Azure Functions — Processor | Flex Consumption FC1, no always-ready | ~$0–2 (pay-per-call) |
| Azure Blob Storage | Standard LRS, StorageV2 | ~$1–3 |
| Azure Storage Queues | Included in storage account | $0 (free tier ops) |
| Log Analytics Workspace | PerGB2018, 30-day retention | $0 (< 500 MB/day free) |
| Application Insights | Workspace-based | $0 (< 5 GB/month free) |
| Modal.com BiRefNet | Per-second GPU billing, scale-to-zero | ~$0–5 (per usage) |
| Azure OpenAI GPT-4.1-mini | Serverless pay-per-token | ~$1–10 |

**Estimated total: < $20/month at typical personal-use traffic.**

### Cost Optimisation Decisions

- **No always-ready instances** on either Function App — cold starts are acceptable for personal use.
- **LRS replication** on Blob Storage — single-region redundancy is sufficient; RA-GRS would triple storage costs.
- **GPT-4.1-mini** instead of GPT-4o — ~20× cheaper per million tokens.
- **Cosmos DB Free Tier** — a single free-tier account per subscription covers the entire data layer.
- **Shared throughput pool** on the Cosmos DB database — 1,000 RU/s split across all containers rather than provisioning each container separately.
- **TTL on ephemeral containers** — `StylingActivity` (90 days), `Conversations` (30 days), `DigestFeedback` (90 days) auto-expire stale documents, bounding RU consumption and storage.
- **Modal scale-to-zero GPU** — the BiRefNet segmenter has zero cost when idle; no reserved GPU instance.
- **Free-tier Static Web App** — no Standard-tier EasyAuth; Google token validation is done in-process on the API, avoiding the $9/month SWA Standard charge.

---

## Azure Infrastructure

All resources are in resource group **PluckIt-RG** (West Europe).

| Resource | Name | Notes |
|---|---|---|
| Resource Group | `PluckIt-RG` | All resources co-located |
| Storage Account (app data) | *(see infra/backend.tf)* | Blobs, queues, tfstate |
| Storage Account (Functions) | *(see infra/main.tf)* | Deployment package blobs only |
| Cosmos DB Account | `pluckit-prod-cosmos` | Free tier, Session consistency |
| Cosmos DB Database | `PluckIt` | Shared 1,000 RU/s throughput |
| Cosmos Containers | Wardrobe, WearEvents, StylingActivity, UserProfiles, Conversations, Digests, Moods, DigestFeedback, Collections | See `infra/main.tf` for partition keys and index policies |
| .NET Function App | `pluckit-prod-api-func` | Flex Consumption, dotnet-isolated 10.0 |
| Python Function App | `pluckit-prod-processor-func` | Flex Consumption, Python 3.12 |
| Static Web App | `pluckit-prod-web` | Free tier, East Asia, custom domain |
| Log Analytics | `pluckit-prod-logs` | 30-day retention |
| Application Insights | `pluckit-prod-appinsights` | Workspace-based |

### Terraform Workflow

```bash
cd infra
terraform init          # first time or after provider upgrades
terraform plan          # always review before pushing
terraform apply         # local apply; CI applies on push to main
```

> **Rule**: Never provision or modify Azure resources via the `az` CLI, Portal, or any imperative tool. All infrastructure changes go through Terraform.

---

## CI/CD — GitHub Actions

| Workflow | Trigger | Action |
|---|---|---|
| `terraform-infra.yml` | push/PR on `infra/**` | Plan (PR) or Apply (push to `main`) |
| `backend-ci.yml` | push/PR on `PluckIt.Functions/**`, `PluckIt.Core/**`, `PluckIt.Infrastructure/**` | Build & deploy .NET Functions |
| `frontend-ci.yml` | push/PR on `PluckIt.Client/**` | Build Angular, deploy to SWA |
| `function-ci.yml` | push on `PluckIt.Processor/**` | Deploy Python Functions |
| `modal-deploy.yml` | push on `PluckIt.Segmentation.Modal/**` | `modal deploy` BiRefNet segmenter |

- **PRs** run build/plan only — no deployments.
- **Push to `main`** deploys to production.
- The `azure-production` concurrency group prevents Terraform and Python Function deployments from racing.

---

## Local Development

> Full setup instructions are in [QUICKSTART.md](QUICKSTART.md). Key points below.

### Prerequisites

- .NET 10 SDK
- Node.js 22 + Angular CLI v19+
- Python 3.12
- Azure Functions Core Tools v4 (`func`)
- Terraform >= 1.9

### Devcontainer / Codespaces

The `.devcontainer/` directory includes a fully configured environment with all toolchains pre-installed. A `post-create.sh` script runs automatically to restore packages and create `local.settings.json` files from Codespaces secrets.

```bash
# Create from GitHub UI: Code → Codespaces → New codespace
```

### Running Locally

```bash
# .NET API (port 7071)
cd PluckIt.Functions
func start --port 7071

# Python Processor (port 7072)
cd PluckIt.Processor
source .venv/bin/activate
func start --port 7072

# Angular SPA (port 4200, proxies to Functions)
cd PluckIt.Client
npm start
```

### Required Local Secrets

Add these to `PluckIt.Functions/local.settings.json` and `PluckIt.Processor/local.settings.json` (both are gitignored):

- `AZURE_WEBJOBS_STORAGE` — Azure Storage connection string (required for queue triggers)
- `Cosmos__Endpoint`, `Cosmos__Key` — Cosmos DB credentials
- `AI__Endpoint`, `AI__ApiKey` — Azure OpenAI
- `BlobStorage__AccountName`, `BlobStorage__AccountKey` — Blob Storage
- `GOOGLE_CLIENT_ID` / `GoogleAuth__ClientId` — Google OAuth client ID
- `GOOGLE_AUTH_JWKS_URL` (optional) / `GoogleAuth__JwksUrl` — Google JWKS endpoint
- `SEGMENTATION_ENDPOINT_URL`, `SEGMENTATION_SHARED_TOKEN` — Modal segmentation
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` — Langfuse tracing credentials
- `LANGFUSE_HOST` (optional) — Langfuse API host (defaults to `https://us.cloud.langfuse.com`)  
  You can also use `LANGFUSE_BASE_URL` in place of `LANGFUSE_HOST`.

For Codespaces, add the same names as **Codespaces secrets** (not Actions secrets — they are separate namespaces).
For CI, set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and optional `LANGFUSE_HOST` in GitHub Action secrets so `terraform-infra.yml` can pass them into `terraform.auto.tfvars`.

---

## Validation

Run these after every change before considering work complete:

```bash
# Frontend
cd PluckIt.Client && npm run build

# .NET backend
dotnet build PluckIt.sln

# Python processor
cd PluckIt.Processor && python -m py_compile function_app.py

# Terraform
cd infra && terraform validate && terraform plan
```

---

## Project Status

- Full Clean Architecture (.NET 10 — Core / Infrastructure / Functions)
- Angular 19+ SPA — standalone components, signals, SSE client
- Azure infrastructure fully provisioned via Terraform (IaC)
- Google Identity Services authentication (in-process token validation)
- Digital closet — upload, tag, sort, filter, wear tracking
- Collections — shared wardrobe groups with member invite
- AI Stylist — LangGraph ReAct agent, streaming SSE, conversation memory
- Wardrobe Digest — weekly AI purchase suggestions + feedback loop
- Vault Insights — cost-per-wear analytics
- Fashion Mood Trends — daily RSS extraction, embedding-based deduplication
- BiRefNet background removal — GPU on Modal.com, scales to zero
- Async image processing pipeline via Azure Storage Queue
- Application Insights telemetry across all services
- 5 CI/CD pipelines (Terraform, .NET Functions, Angular SWA, Python Functions, Modal)
- xUnit unit & integration test suite
