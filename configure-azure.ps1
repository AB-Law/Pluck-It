# Configure Azure App Service with Connection Strings

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Configure Azure App Service" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

$resourceGroup = "PluckIt-RG"
$appName = "pluckit-prod-api"
$cosmosAccount = "pluckit-prod-cosmos"
$storageAccount = "pluckitprodsa8dedj4"

Write-Host "Retrieving Cosmos DB connection string..." -ForegroundColor Yellow
$cosmosConnString = az cosmosdb keys list `
    --name $cosmosAccount `
    --resource-group $resourceGroup `
    --type connection-strings `
    --query "connectionStrings[0].connectionString" `
    -o tsv

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to retrieve Cosmos DB connection string!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Cosmos DB connection string retrieved" -ForegroundColor Green

Write-Host "Retrieving Blob Storage connection string..." -ForegroundColor Yellow
$storageConnString = az storage account show-connection-string `
    --name $storageAccount `
    --resource-group $resourceGroup `
    --query "connectionString" `
    -o tsv

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to retrieve Storage connection string!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Blob Storage connection string retrieved" -ForegroundColor Green
Write-Host ""

Write-Host "Configuring App Service settings..." -ForegroundColor Yellow

# Set connection strings
az webapp config connection-string set `
    --name $appName `
    --resource-group $resourceGroup `
    --connection-string-type Custom `
    --settings CosmosDb="$cosmosConnString" BlobStorage="$storageConnString"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to set connection strings!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Connection strings configured" -ForegroundColor Green

# Set app settings
az webapp config appsettings set `
    --name $appName `
    --resource-group $resourceGroup `
    --settings `
        "Azure__CosmosDb__Endpoint=https://pluckit-prod-cosmos.documents.azure.com:443/" `
        "Azure__CosmosDb__DatabaseName=PluckIt" `
        "Azure__CosmosDb__ContainerName=Wardrobe" `
        "Azure__BlobStorage__AccountName=pluckitprodsa8dedj4" `
        "Azure__BlobStorage__UploadsContainer=uploads" `
        "Azure__BlobStorage__ArchiveContainer=archive" `
        "Azure__ResourceGroup=PluckIt-RG" `
        "Azure__FunctionAppName=pluckit-prod-processor-func"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to set app settings!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ App settings configured" -ForegroundColor Green
Write-Host ""

Write-Host "Restarting App Service..." -ForegroundColor Yellow
az webapp restart --name $appName --resource-group $resourceGroup

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Configuration Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your API is now configured and ready to use!" -ForegroundColor Green
Write-Host "API URL: https://$appName.azurewebsites.net" -ForegroundColor Cyan
Write-Host ""
