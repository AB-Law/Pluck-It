# Quick Start Guide - PluckIt

## Initial Setup Complete! 🎉

### What's Been Set Up:

#### Backend (.NET 10)
- ✅ Clean Architecture structure (Api, Core, Infrastructure)
- ✅ Project references configured correctly
- ✅ Swagger UI for API testing
- ✅ Running on http://localhost:5180

#### Frontend (Angular 19)
- ✅ Standalone components with signals
- ✅ Routing configured
- ✅ Environment configuration (dev & prod)
- ✅ Core API service
- ✅ Feature folder structure (closet, stylist)
- ✅ Running on http://localhost:4200

#### DevOps
- ✅ `.gitignore` for .NET & Angular
- ✅ GitHub Actions CI/CD for backend
- ✅ GitHub Actions CI/CD for frontend

## Quick Commands

### Backend
```powershell
# Build
dotnet build

# Run API
cd PluckIt.Server/PluckIt.Api
dotnet run

# Access Swagger
# Navigate to: http://localhost:5180/swagger
```

### Frontend
```powershell
# Install dependencies (first time)
cd PluckIt.Client
npm install

# Run dev server
npm start

# Access app
# Navigate to: http://localhost:4200
```

## Next Steps

1. **Domain Models**: Add entities to `PluckIt.Core`
2. **API Endpoints**: Create controllers in `PluckIt.Api`
3. **Angular Components**: Build feature components in `PluckIt.Client/src/app/features`
4. **Azure Integration**: Configure Blob Storage, Cosmos DB, Computer Vision
5. **Authentication**: Implement auth in both frontend and backend

## Project Structure
```
/Pluck-It
├── .github/workflows/          # CI/CD pipelines
├── PluckIt.Client/             # Angular 19 App
│   ├── src/app/
│   │   ├── core/               # Services & interceptors
│   │   ├── features/
│   │   │   ├── closet/        # Gallery & uploads
│   │   │   └── stylist/       # AI chat
│   │   └── shared/            # Reusable components
├── PluckIt.Server/
│   ├── PluckIt.Api/           # Web API
│   ├── PluckIt.Core/          # Domain layer
│   └── PluckIt.Infrastructure/ # External services
└── PluckIt.sln
```

## Available Endpoints

### Backend API
- Weather Forecast (sample): `GET /weatherforecast`
- Swagger UI: http://localhost:5180/swagger
- OpenAPI spec: http://localhost:5180/openapi/v1.json

### Frontend
- Home: http://localhost:4200

## Tips

- Both servers can run simultaneously
- Frontend proxies to backend via `environment.apiUrl`
- Use Swagger to test API endpoints before integrating with frontend
- GitHub Actions will run on every push to `main` or `develop`
