# Azure Infrastructure Outputs

## Deployed Resources ✅

### Resource Group
- **Name**: PluckIt-RG
- **Location**: Central India

### Storage Account
- **Name**: pluckitprodsa8dedj4
- **Containers**:
  - uploads (for user wardrobe images)
  - archive (for processed images)
  - tfstate (for Terraform state - future use)

### Cosmos DB
- **Account**: pluckit-prod-cosmos
- **Endpoint**: https://pluckit-prod-cosmos.documents.azure.com:443/
- **Database**: PluckIt
- **Container**: Wardrobe
- **Partition Key**: /id
- **Free Tier**: Enabled ✅

### App Services
- **API App**: pluckit-prod-api.azurewebsites.net
- **API Plan**: pluckit-prod-api-plan (B1 Linux)
- **Function App**: pluckit-prod-processor-func
- **Function Plan**: pluckit-prod-func-plan (Y1 Consumption)

## Connection Strings & Secrets

### Get Cosmos DB Connection String
```powershell
az cosmosdb keys list --name pluckit-prod-cosmos --resource-group PluckIt-RG --type connection-strings --query "connectionStrings[0].connectionString" -o tsv
```

### Get Storage Account Key
```powershell
az storage account keys list --account-name pluckitprodsa8dedj4 --resource-group PluckIt-RG --query "[0].value" -o tsv
```

### Get Storage Connection String
```powershell
az storage account show-connection-string --name pluckitprodsa8dedj4 --resource-group PluckIt-RG --query "connectionString" -o tsv
```

## Next Steps

### 1. Update .NET appsettings.json
Add these connection strings to your API configuration:

```json
{
  "ConnectionStrings": {
    "CosmosDb": "<Get from Azure Portal or CLI>",
    "BlobStorage": "<Get from Azure Portal or CLI>"
  },
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
```

### 2. Deploy .NET API
```powershell
cd PluckIt.Server/PluckIt.Api
dotnet publish -c Release
# Then deploy to pluckit-prod-api using Azure CLI or VS Code
```

### 3. Configure Frontend
Update `PluckIt.Client/src/environments/environment.prod.ts`:
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://pluckit-prod-api.azurewebsites.net'
};
```

### 4. Migrate to Azure Remote Backend (Optional)
Once comfortable with the setup:
1. Uncomment the azurerm backend in `backend.tf`
2. Update storage_account_name to "pluckitprodsa8dedj4"
3. Run: `terraform init -migrate-state`

## Cost Estimate
- Cosmos DB: **FREE** (Free Tier - 1000 RU/s, 25 GB)
- Storage: ~$0.02/GB/month
- App Service B1: ~$13/month
- Function App Y1: First 1M executions free

**Estimated Monthly Cost**: ~$15-20/month
