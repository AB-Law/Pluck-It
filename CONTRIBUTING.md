# Contributing to Pluck-It

## Branch strategy

| Branch | Purpose |
|---|---|
| `main` | Production — only merge from `dev` via PR after QA |
| `dev` | Integration branch — all features land here |
| `feature/<name>` | Your day-to-day work |
| `fix/<name>` | Bug fixes |

**Workflow:**

```
feature/my-thing  →  dev  →  main
```

```bash
# Start a new feature
git checkout dev
git pull origin dev
git checkout -b feature/my-thing

# When done, open a PR targeting dev (not main)
```

Never push directly to `main` or `dev`.

---

## Local dev setup

See [QUICKSTART.md](QUICKSTART.md) for the full setup guide. The short version:

1. Copy and configure `local.settings.json` files
2. Start Azurite + Cosmos DB Emulator
3. Run `func start` in both `PluckIt.Functions` (port 7072) and `PluckIt.Processor` (port 7071)
4. Run `npm start` in `PluckIt.Client` (port 4200)

---

## Project structure

```
Pluck-It/
├── PluckIt.Client/             # Angular 19 frontend (signals, standalone components)
├── PluckIt.Core/               # C# interfaces & domain models (no dependencies)
├── PluckIt.Infrastructure/     # C# implementations: Cosmos repos, BlobSasService
├── PluckIt.Functions/          # C# Azure Functions: wardrobe CRUD, auth, collections
├── PluckIt.Processor/          # Python Azure Functions: AI agents, image processing
│   ├── agents/                 # LangChain/LangGraph agents (stylist, digest, etc.)
│   ├── agents/tools/           # Agent tools (wardrobe search, weather, wear patterns)
│   ├── agents/scrapers/        # Brand scraper pipeline
│   └── tests/                  # Pytest unit tests
├── PluckIt.Segmentation.Modal/ # Modal.com GPU service (BiRefNet background removal)
├── PluckIt.Tests/              # .NET xUnit tests
├── cosmos-backup/              # Admin scripts: export/import Cosmos data
└── infra/                      # Terraform (Azure resources)
```

---

## Tech stack

- **Frontend**: Angular 19, standalone components, signals, Angular CDK
- **C# backend**: Azure Functions v4 isolated worker, .NET 10
- **Python backend**: Azure Functions v2 (Python), FastAPI for SSE, LangChain + LangGraph
- **Database**: Azure Cosmos DB (NoSQL, partition key per container — see QUICKSTART.md)
- **Storage**: Azure Blob Storage (uploads, archive containers)
- **Queues**: Azure Storage Queues (taste analysis jobs)
- **AI**: Azure OpenAI (`gpt-4.1-mini`, `text-embedding-3-small`)
- **Auth**: Google Identity Services (GIS) — JWT verified server-side
- **Observability**: Langfuse (LLM tracing), OpenTelemetry → Grafana Cloud
- **Segmentation**: Modal.com (BiRefNet, GPU)
- **Infra**: Terraform

---

## Making changes

### C# (PluckIt.Functions / PluckIt.Infrastructure / PluckIt.Core)

```bash
dotnet build        # verify it compiles
dotnet test         # run all tests
```

Follow existing patterns:
- Interfaces live in `PluckIt.Core`
- Cosmos DB implementations in `PluckIt.Infrastructure`
- Function triggers in `PluckIt.Functions/Functions/`
- Auth is injected via `IUserAuthService` — don't bypass it

### Python (PluckIt.Processor)

```bash
cd PluckIt.Processor
source .venv/bin/activate
pytest -m unit      # fast unit tests, no I/O
```

Follow existing patterns:
- LLM clients are lazy singletons (`_get_llm()` / `_get_nano_llm()`) — don't create them per-request
- Cosmos DB clients use the singleton helpers in `agents/db.py`
- All agents are async; use `async def` and `await` throughout
- New agent tools go in `agents/tools/` and should be decorated with `@tool`

### Angular (PluckIt.Client)

```bash
cd PluckIt.Client
npm test            # unit tests (Karma)
npm run test:e2e    # Playwright e2e
```

Follow existing patterns:
- Standalone components only — no `NgModule`
- Use Angular signals for state, not RxJS Subject/BehaviorSubject for new code
- Feature modules live in `src/app/features/<feature>/`
- API calls go through services in `src/app/core/services/`

---

## Adding a new Cosmos DB container

1. Add the container name as an env var in both `local.settings.json.example` files
2. Add a helper in `PluckIt.Processor/agents/db.py` (for Python) or inject `CosmosClient` in the C# service
3. Add the container to the table in [QUICKSTART.md](QUICKSTART.md) with its partition key
4. Add the container to the Terraform config in `infra/`

---

## Pull request checklist

- [ ] Branch targets `dev`, not `main`
- [ ] `dotnet test` passes (or `pytest -m unit` for Python changes)
- [ ] No `local.settings.json` files committed
- [ ] No production credentials in code or comments
- [ ] New env vars documented in the relevant `local.settings.json.example`

---

## Environment variables

All config is via environment variables loaded from `local.settings.json` locally and Azure Function App Settings in production.

- `PluckIt.Functions/local.settings.json.example` — C# function settings
- `PluckIt.Processor/local.settings.json.example` — Python function settings

When adding a new variable: add it to both example files with a clear placeholder value and a comment explaining what it is.

---

## Secrets

- Never commit real credentials, keys, or connection strings
- `local.settings.json` is gitignored — keep secrets there
- For CI/CD, secrets are stored in GitHub Actions secrets and injected at deploy time
- Production keys are in Azure Key Vault (accessed via managed identity)
