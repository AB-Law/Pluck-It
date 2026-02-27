# Deploy PluckIt API to Azure App Service

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "PluckIt API - Azure Deployment" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$resourceGroup = "PluckIt-RG"
$appName = "pluckit-prod-api"
$location = "Central India"

# Navigate to API project
$apiPath = Join-Path $PSScriptRoot "PluckIt.Server\PluckIt.Api"
Set-Location $apiPath

Write-Host "1. Building the application..." -ForegroundColor Yellow
dotnet publish -c Release -o ./publish

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Build completed successfully" -ForegroundColor Green
Write-Host ""

Write-Host "2. Creating deployment package..." -ForegroundColor Yellow
$publishPath = Join-Path $apiPath "publish"
$zipPath = Join-Path $apiPath "deploy.zip"

# Remove old zip if exists
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

# Create zip file
Compress-Archive -Path "$publishPath\*" -DestinationPath $zipPath -Force

Write-Host "✓ Deployment package created" -ForegroundColor Green
Write-Host ""

Write-Host "3. Deploying to Azure..." -ForegroundColor Yellow
Write-Host "   App Service: $appName" -ForegroundColor Gray
Write-Host "   Resource Group: $resourceGroup" -ForegroundColor Gray

az webapp deployment source config-zip `
    --resource-group $resourceGroup `
    --name $appName `
    --src $zipPath

if ($LASTEXITCODE -ne 0) {
    Write-Host "Deployment failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Deployment completed successfully" -ForegroundColor Green
Write-Host ""

Write-Host "4. Restarting App Service..." -ForegroundColor Yellow
az webapp restart --name $appName --resource-group $resourceGroup

Write-Host "✓ App Service restarted" -ForegroundColor Green
Write-Host ""

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "API URL: https://$appName.azurewebsites.net" -ForegroundColor Cyan
Write-Host "Swagger: https://$appName.azurewebsites.net/swagger" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Configure connection strings in Azure Portal or using Azure CLI" -ForegroundColor White
Write-Host "2. Test the API at the URL above" -ForegroundColor White
Write-Host "3. Check logs if needed: az webapp log tail --name $appName --resource-group $resourceGroup" -ForegroundColor White
Write-Host ""

# Cleanup
Remove-Item $zipPath -Force
Remove-Item $publishPath -Recurse -Force

Write-Host "Cleaned up temporary files" -ForegroundColor Gray
