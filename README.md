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
