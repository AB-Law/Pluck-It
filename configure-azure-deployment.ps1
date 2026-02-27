# Azure Deployment Configuration Script
# Run this to get all necessary secrets and configure Azure services

Write-Host "=================================" -ForegroundColor Cyan
Write-Host "PluckIt Azure Deployment Setup" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Check if logged in to Azure
Write-Host "Checking Azure CLI login..." -ForegroundColor Yellow
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "Not logged in to Azure. Running 'az login'..." -ForegroundColor Red
    az login
} else {
    Write-Host "[OK] Logged in as: $($account.user.name)" -ForegroundColor Green
}

Write-Host ""

# Variables from Terraform outputs
$resourceGroup = "PluckIt-RG"
$storageAccount = "pluckitprodsa8dedj4"
$cosmosAccount = "pluckit-prod-cosmos"
$webAppName = "pluckit-prod-api"
$staticWebAppName = "pluckit-prod-web"

# ============================================
# 1. Get Cosmos DB Connection String
# ============================================
Write-Host "1. Getting Cosmos DB connection string..." -ForegroundColor Yellow
$cosmosConnString = az cosmosdb keys list `
    --name $cosmosAccount `
    --resource-group $resourceGroup `
    --type connection-strings `
    --query "connectionStrings[0].connectionString" -o tsv

Write-Host "[OK] Cosmos DB Connection String retrieved" -ForegroundColor Green
Write-Host "   Copy this to GitHub Secret or App Service Configuration:" -ForegroundColor Cyan
Write-Host "   $cosmosConnString" -ForegroundColor White
Write-Host ""

# ============================================
# 2. Get Storage Account Connection String
# ============================================
Write-Host "2. Getting Storage Account connection string..." -ForegroundColor Yellow
$storageConnString = az storage account show-connection-string `
    --name $storageAccount `
    --resource-group $resourceGroup `
    --query "connectionString" -o tsv

Write-Host "[OK] Storage Account Connection String retrieved" -ForegroundColor Green
Write-Host "   Copy this to GitHub Secret or App Service Configuration:" -ForegroundColor Cyan
Write-Host "   $storageConnString" -ForegroundColor White
Write-Host ""

# ============================================
# 3. Configure App Service Settings
# ============================================
Write-Host "3. Configuring Azure Web App application settings..." -ForegroundColor Yellow

az webapp config appsettings set `
    --name $webAppName `
    --resource-group $resourceGroup `
    --settings `
        "Azure__CosmosDb__Endpoint=https://pluckit-prod-cosmos.documents.azure.com:443/" `
        "Azure__CosmosDb__DatabaseName=PluckIt" `
        "Azure__CosmosDb__ContainerName=Wardrobe" `
        "Azure__BlobStorage__AccountName=$storageAccount" `
        "Azure__BlobStorage__UploadsContainer=uploads" `
        "Azure__BlobStorage__ArchiveContainer=archive" `
    | Out-Null

Write-Host "[OK] App Service application settings configured" -ForegroundColor Green
Write-Host ""

Write-Host "4. Configuring Azure Web App connection strings..." -ForegroundColor Yellow

# Connection strings need special format - use Azure CLI connection-string-type
az webapp config connection-string set `
    --name $webAppName `
    --resource-group $resourceGroup `
    --connection-string-type Custom `
    --settings CosmosDb="$cosmosConnString" BlobStorage="$storageConnString" `
    | Out-Null

Write-Host "[OK] App Service connection strings configured" -ForegroundColor Green
Write-Host ""

# ============================================
# 5. Get Web App Publish Profile
# ============================================
Write-Host "5. Getting Web App publish profile for GitHub Actions..." -ForegroundColor Yellow
Write-Host "   This needs to be added as AZURE_WEBAPP_PUBLISH_PROFILE secret in GitHub" -ForegroundColor Cyan
Write-Host ""
Write-Host "=== COPY THIS ENTIRE XML FOR GITHUB SECRET ===" -ForegroundColor Yellow
az webapp deployment list-publishing-profiles `
    --name $webAppName `
    --resource-group $resourceGroup `
    --xml
Write-Host "=== END OF PUBLISH PROFILE ===" -ForegroundColor Yellow
Write-Host ""

# ============================================
# 6. Create Static Web App (if not exists)
# ============================================
Write-Host "6. Checking/Creating Static Web App..." -ForegroundColor Yellow
$staticWebApp = az staticwebapp show `
    --name $staticWebAppName `
    --resource-group $resourceGroup 2>$null

if (-not $staticWebApp) {
    Write-Host "   Creating Static Web App..." -ForegroundColor Cyan
    az staticwebapp create `
        --name $staticWebAppName `
        --resource-group $resourceGroup `
        --location eastasia `
        --sku Free `
        | Out-Null
    Write-Host "[OK] Static Web App created" -ForegroundColor Green
} else {
    Write-Host "[OK] Static Web App already exists" -ForegroundColor Green
}

# ============================================
# 7. Get Static Web App Deployment Token
# ============================================
Write-Host "7. Getting Static Web App deployment token for GitHub Actions..." -ForegroundColor Yellow
$staticWebToken = az staticwebapp secrets list `
    --name $staticWebAppName `
    --resource-group $resourceGroup `
    --query "properties.apiKey" -o tsv

Write-Host "[OK] Static Web App deployment token retrieved" -ForegroundColor Green
Write-Host "   Add this as AZURE_STATIC_WEB_APPS_API_TOKEN secret in GitHub:" -ForegroundColor Cyan
Write-Host "   $staticWebToken" -ForegroundColor White
Write-Host ""

# ============================================
# Summary
# ============================================
Write-Host "=================================" -ForegroundColor Cyan
Write-Host "Configuration Complete!" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Add the following GitHub Secrets:" -ForegroundColor White
Write-Host "   - AZURE_WEBAPP_PUBLISH_PROFILE (XML from above)" -ForegroundColor White
Write-Host "   - AZURE_STATIC_WEB_APPS_API_TOKEN (token from above)" -ForegroundColor White
Write-Host ""
Write-Host "2. Push to main branch to trigger deployment" -ForegroundColor White
Write-Host ""
Write-Host "3. Access your deployed applications:" -ForegroundColor White
Write-Host "   - Backend API: https://$webAppName.azurewebsites.net" -ForegroundColor Cyan
Write-Host "   - Frontend: https://$staticWebAppName.azurestaticapps.net" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Check deployment status in GitHub Actions tab" -ForegroundColor White
Write-Host ""
