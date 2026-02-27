# Azure Configuration - Secrets Retrieval

## Get Connection Strings from Azure

### Cosmos DB Connection String
```powershell
# Get Primary Connection String
az cosmosdb keys list `
  --name pluckit-prod-cosmos `
  --resource-group PluckIt-RG `
  --type connection-strings `
  --query "connectionStrings[0].connectionString" `
  -o tsv

# Or get just the Primary Key
az cosmosdb keys list `
  --name pluckit-prod-cosmos `
  --resource-group PluckIt-RG `
  --query "primaryMasterKey" `
  -o tsv
```

### Blob Storage Connection String
```powershell
az storage account show-connection-string `
  --name pluckitprodsa8dedj4 `
  --resource-group PluckIt-RG `
  --query "connectionString" `
  -o tsv
```

### Storage Account Key
```powershell
az storage account keys list `
  --account-name pluckitprodsa8dedj4 `
  --resource-group PluckIt-RG `
  --query "[0].value" `
  -o tsv
```

## Update Configuration Files

### Option 1: Local appsettings (for testing)
1. Run the commands above to get the connection strings
2. Update `appsettings.Development.json` or `appsettings.Production.json`
3. **NEVER commit these files with real secrets!**

### Option 2: Azure App Service Configuration (Recommended)
Set the secrets directly in Azure App Service:

```powershell
# Set Cosmos DB Connection String
$cosmosConnString = az cosmosdb keys list --name pluckit-prod-cosmos --resource-group PluckIt-RG --type connection-strings --query "connectionStrings[0].connectionString" -o tsv

az webapp config appsettings set `
  --name pluckit-prod-api `
  --resource-group PluckIt-RG `
  --settings "ConnectionStrings__CosmosDb=$cosmosConnString"

# Set Blob Storage Connection String
$storageConnString = az storage account show-connection-string --name pluckitprodsa8dedj4 --resource-group PluckIt-RG --query "connectionString" -o tsv

az webapp config appsettings set `
  --name pluckit-prod-api `
  --resource-group PluckIt-RG `
  --settings "ConnectionStrings__BlobStorage=$storageConnString"
```

### Option 3: Use Azure Key Vault (Best Practice)
For production, store secrets in Azure Key Vault and reference them in App Service.

## Configuration Structure

The application expects these configuration values:

```json
{
  "ConnectionStrings": {
    "CosmosDb": "AccountEndpoint=...;AccountKey=...",
    "BlobStorage": "DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
  },
  "Azure": {
    "CosmosDb": {
      "Endpoint": "https://pluckit-prod-cosmos.documents.azure.com:443/",
      "DatabaseName": "PluckIt",
      "ContainerName": "Wardrobe"
    },
    "BlobStorage": {
      "AccountName": "pluckitprodsa8dedj4",
      "UploadsContainer": "uploads",
      "ArchiveContainer": "archive"
    }
  }
}
```

## Security Notes

⚠️ **IMPORTANT**:
- Never commit real connection strings to Git
- Use Azure App Service Configuration or Key Vault for production
- The placeholder values in `appsettings.json` are for reference only
- `.gitignore` should exclude `appsettings.*.json` except `appsettings.Development.json`
