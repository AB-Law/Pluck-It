# GitHub Actions Deployment Setup

## Required GitHub Secrets

You need to add the following secrets to your GitHub repository for automated deployments to work.

### How to Add Secrets
1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each secret below

---

## Backend Deployment Secret

### `AZURE_WEBAPP_PUBLISH_PROFILE`

**Get the publish profile from Azure:**

```powershell
# Using Azure CLI
az webapp deployment list-publishing-profiles `
  --name pluckit-prod-api `
  --resource-group PluckIt-RG `
  --xml
```

**OR via Azure Portal:**
1. Go to Azure Portal → App Services
2. Select `pluckit-prod-api`
3. Click **Get publish profile** in the Overview page
4. Copy the entire XML content
5. Paste it as the secret value in GitHub

---

## Frontend Deployment Secret

### `AZURE_STATIC_WEB_APPS_API_TOKEN`

**Note:** You need to create an Azure Static Web App first, or use Azure Blob Storage with Static Website hosting.

**Option 1: Create Static Web App (Recommended)**

```powershell
# Create Static Web App
az staticwebapp create `
  --name pluckit-prod-web `
  --resource-group PluckIt-RG `
  --location centralindia `
  --sku Free

# Get the deployment token
az staticwebapp secrets list `
  --name pluckit-prod-web `
  --resource-group PluckIt-RG `
  --query "properties.apiKey" -o tsv
```

Copy the token and add it as `AZURE_STATIC_WEB_APPS_API_TOKEN` in GitHub secrets.

**Option 2: Use Storage Account Static Website**

If you want to use the existing storage account instead:

1. Enable static website hosting:
```powershell
az storage blob service-properties update `
  --account-name pluckitprodsa8dedj4 `
  --static-website `
  --index-document index.html `
  --404-document index.html
```

2. Update the frontend workflow to use Azure Blob Storage deployment instead:
   - Replace `Azure/static-web-apps-deploy` action
   - Use `azure/CLI@v1` to upload to blob storage

---

## Quick Setup Commands

Run these commands to get all secrets at once:

```powershell
# 1. Get Backend Publish Profile
Write-Host "`n=== BACKEND PUBLISH PROFILE ===" -ForegroundColor Green
az webapp deployment list-publishing-profiles `
  --name pluckit-prod-api `
  --resource-group PluckIt-RG `
  --xml

# 2. Create Static Web App and get token
Write-Host "`n`n=== CREATING STATIC WEB APP ===" -ForegroundColor Green
az staticwebapp create `
  --name pluckit-prod-web `
  --resource-group PluckIt-RG `
  --location centralindia `
  --sku Free

Write-Host "`n=== FRONTEND DEPLOYMENT TOKEN ===" -ForegroundColor Green
az staticwebapp secrets list `
  --name pluckit-prod-web `
  --resource-group PluckIt-RG `
  --query "properties.apiKey" -o tsv
```

---

## Verify Secrets Are Set

Once you've added the secrets, go to:
- **Settings** → **Secrets and variables** → **Actions**

You should see:
- ✅ `AZURE_WEBAPP_PUBLISH_PROFILE`
- ✅ `AZURE_STATIC_WEB_APPS_API_TOKEN`

---

## Test the Deployment

1. Commit and push your changes to `main` branch
2. Go to **Actions** tab in GitHub
3. You should see two workflows running:
   - **Backend CI/CD** - Deploys API to Azure App Service
   - **Frontend CI/CD** - Deploys Angular app to Static Web App

---

## Deployment URLs

After successful deployment:

- **Backend API**: https://pluckit-prod-api.azurewebsites.net
- **Frontend**: https://pluckit-prod-web.azurestaticapps.net (once Static Web App is created)

---

## Environment Configuration

The workflows are configured to:
- **Backend**: Deploy to `pluckit-prod-api` Azure Web App
- **Frontend**: Build with production API URL: `https://pluckit-prod-api.azurewebsites.net`
- **Triggers**: Only deploy on push to `main` branch (PRs will build but not deploy)

---

## Troubleshooting

### Backend deployment fails
- Verify `AZURE_WEBAPP_PUBLISH_PROFILE` secret is correct
- Check that the App Service `pluckit-prod-api` exists
- Review workflow logs in GitHub Actions

### Frontend deployment fails
- Verify `AZURE_STATIC_WEB_APPS_API_TOKEN` secret is correct
- Ensure Static Web App exists or use blob storage alternative
- Check build output path matches deployment settings

### API not accessible after deployment
- Check App Service logs in Azure Portal
- Verify connection strings are configured in App Service Configuration
- Ensure .NET 10 runtime is supported
