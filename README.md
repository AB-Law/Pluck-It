# PluckIt - Digital Wardrobe Application

A modern digital wardrobe application with AI-powered styling suggestions.

## Architecture

### Frontend
- **Framework**: Angular 19+ with standalone components and signals
- **Location**: `PluckIt.Client/`
- **Structure**:
  - `core/` - Global services (Auth, API Interceptors)
  - `features/closet/` - Gallery & Image Upload
  - `features/stylist/` - AI Suggestion Chat
  - `shared/` - Reusable UI components

### Backend
- **Framework**: ASP.NET Core Web API (.NET 10)
- **Architecture**: Clean Architecture
- **Location**: `PluckIt.Server/`

#### Project Structure
- **PluckIt.Api** - Controllers, endpoints, and API configuration
- **PluckIt.Core** - Domain entities, interfaces, and business logic
- **PluckIt.Infrastructure** - External service implementations (Azure Blob, Cosmos DB, Computer Vision)

#### Dependencies
```
PluckIt.Api
├── PluckIt.Core
└── PluckIt.Infrastructure
    └── PluckIt.Core
```

## Getting Started

### Prerequisites
- .NET 10 SDK
- Node.js 20+
- Angular CLI v19+

### GitHub Codespaces

This repository includes a preconfigured Codespaces/dev container setup in `.devcontainer/`.

- Installs toolchains: .NET 10, Node.js 22, Python 3.12, Azure CLI, Terraform, GitHub CLI
- Installs dependencies on create via `.devcontainer/scripts/post-create.sh`
  - `dotnet restore` for the solution
  - `npm ci` in `PluckIt.Client`
  - Python virtual environment + `pip install -r requirements.txt` in `PluckIt.Processor`
  - Installs Azure Functions Core Tools (`func`)
  - Creates `PluckIt.Functions/local.settings.json` and `PluckIt.Processor/local.settings.json` if missing

To use it, create a new Codespace from the repository. The setup runs automatically during container creation.

#### Secrets in Codespaces vs GitHub Actions

GitHub Actions `secrets.*` are **not** automatically injected into Codespaces runtime.

For Codespaces, add repository/org **Codespaces secrets** (same names is easiest), then rebuild the container.

Recommended secrets for this repo:

- `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (Azure auth / Terraform)
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`
- `AZURE_WEBJOBS_STORAGE` (required for full local Azure Functions runtime)
- `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE`, `COSMOS_CONTAINER`
- `STORAGE_ACCOUNT_NAME`, `STORAGE_ACCOUNT_KEY`, `UPLOAD_CONTAINER`, `ARCHIVE_CONTAINER`

The post-create script maps these into local Function settings files automatically when they exist.

#### Can Codespaces run Function Apps and Terraform?

Yes.

- .NET Function App: `cd PluckIt.Functions && func start`
- Python Function App: `cd PluckIt.Processor && source .venv/bin/activate && func start`
- Terraform: `cd infra && terraform init && terraform plan`

If `AZURE_WEBJOBS_STORAGE` is missing, Functions may start with limited behavior depending on trigger type.

### Running the Backend

```powershell
# Build the solution
dotnet build

# Run the API
cd PluckIt.Server/PluckIt.Api
dotnet run
```

The API will be available at:
- HTTP: http://localhost:5180
- Swagger UI: http://localhost:5180/swagger

### Running the Frontend
```bash
# Navigate to the client folder
cd PluckIt.Client

# Install dependencies (first time only)
npm install

# Start the development server
npm start
```

The Angular app will be available at:
- Local: http://localhost:4200

## API Documentation

When running in development mode, the API exposes Swagger UI for testing endpoints.

Navigate to `http://localhost:5180/swagger` to explore the API.

## Project Status

- ✅ Backend project structure created
- ✅ Clean Architecture layers configured
- ✅ Swagger/OpenAPI documentation enabled
- ✅ Frontend Angular 19 project initialized
- ✅ Standalone components with signals
- ✅ Basic API service and environment config
- ✅ GitHub Actions CI/CD pipelines (backend & frontend)
- ✅ Comprehensive .gitignore for .NET and Angular
- ✅ **Azure Infrastructure Deployed**
  - Cosmos DB (Free Tier): pluckit-prod-cosmos
  - Blob Storage: pluckitprodsa8dedj4
  - App Service: pluckit-prod-api.azurewebsites.net
  - Function App: pluckit-prod-processor-func
- ⏳ Configure connection strings in App Service
- ⏳ Deploy .NET API to Azure
- ⏳ Deploy Angular app
- ⏳ Feature implementations (pending)

## Azure Infrastructure

### Deployed Resources
- **API URL**: https://pluckit-prod-api.azurewebsites.net
- **Cosmos DB**: https://pluckit-prod-cosmos.documents.azure.com:443/
  - Database: PluckIt
  - Container: Wardrobe
- **Storage Account**: pluckitprodsa8dedj4
  - uploads container
  - archive container
- **Function App**: pluckit-prod-processor-func

### Get Connection Strings
```powershell
# Cosmos DB
az cosmosdb keys list --name pluckit-prod-cosmos --resource-group PluckIt-RG --type connection-strings --query "connectionStrings[0].connectionString" -o tsv

# Blob Storage
az storage account show-connection-string --name pluckitprodsa8dedj4 --resource-group PluckIt-RG --query "connectionString" -o tsv
```

See `PluckIt.Server/AZURE_CONFIG.md` for detailed configuration instructions.
- ✅ Swagger/OpenAPI documentation enabled
- ✅ Frontend Angular 19 project initialized
- ✅ Standalone components with signals
- ✅ Basic API service and environment config
- ✅ GitHub Actions CI/CD pipelines (backend & frontend)
- ✅ Comprehensive .gitignore for .NET and Angular
- ⏳ Azure service integration (pending)
- ⏳ Database configuration (pending)
- ⏳ Feature implementations (pending)

## CI/CD

GitHub Actions workflows are configured for both frontend and backend:

### Backend Pipeline (`.github/workflows/backend-ci.yml`)
- Triggers on push/PR to `main` or `develop` branches
- Builds and tests .NET 10 API
- Creates deployment artifacts

### Frontend Pipeline (`.github/workflows/frontend-ci.yml`)
- Triggers on push/PR to `main` or `develop` branches  
- Runs linting and tests
- Builds production-ready Angular bundle
- Creates deployment artifacts
