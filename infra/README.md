# Terraform Infrastructure Setup

## Initial Setup Complete ✅

The Terraform backend has been configured to use **local state** initially. After the first successful apply, you can migrate to Azure remote state.

## Current Configuration

### Backend

- **Type**: Local (for initial setup)
- **State File**: `infra/terraform.tfstate`
- **Future**: Azure Storage Account (after infrastructure creation)

### Resources to be Created

- Resource Group: `PluckIt-RG`
- Storage Account (with blob containers: uploads, archive, tfstate)
- Cosmos DB Account with PluckIt database
- Cosmos DB Container: Wardrobe
- App Service Plan (Linux B1)
- Linux Web App for API
- Static Web App for Angular frontend
- Computer Vision Service (for AI features)

## Terraform Commands

### 1. Preview Changes

```powershell
cd infra
terraform plan
```

### 2. Apply Infrastructure

```powershell
terraform apply
```

### 3. View Outputs

```powershell
terraform output
```

### 4. Destroy Infrastructure (when needed)

```powershell
terraform destroy
```

## Migrating to Azure Remote State (After First Apply)

Once your infrastructure is created:

1. **Uncomment the Azure backend** in `backend.tf`
2. **Update storage account name** (it will be in terraform outputs)
3. **Migrate state**:

   ```powershell
   terraform init -migrate-state
   ```

## Security Notes

⚠️ **IMPORTANT**: The following files contain sensitive data and are gitignored:

- `terraform.tfvars` - Contains subscription ID, API keys
- `terraform.tfstate` - Contains resource IDs and connection strings
- `.terraform/` - Provider plugins

## Variables

Required variables (set in `terraform.tfvars`):

- `subscription_id` - Your Azure subscription ID
- `location` - Azure region (default: centralindia)
- `environment` - Environment name (prod/dev)
- `ai_gpt4o_endpoint` - Azure OpenAI endpoint
- `ai_api_key` - Azure OpenAI API key
- `swa_repository_url` - GitHub repo URL for the Static Web App
- `swa_branch` - Branch for deployments (default: main)
- `swa_repository_token` - GitHub PAT or deployment token
- `swa_app_location` - Frontend app folder (default: PluckIt.Client)
- `swa_output_location` - Build output folder (default: dist/PluckIt.Client)
- `swa_api_location` - API folder (optional, default: "")
- `langfuse_public_key` - Langfuse public key
- `langfuse_secret_key` - Langfuse secret key
- `langfuse_host` - Langfuse host URL (optional, defaults to `https://us.cloud.langfuse.com`)
- `sas_cache_enabled` - Enable shared SAS cache via Redis (defaults to `false`)
- `sas_cache_redis_connection_string` - Redis connection string for shared SAS cache

## Next Steps

1. Review the plan: `terraform plan`
2. Apply if everything looks good: `terraform apply`
3. Note the outputs (storage account name, connection strings, etc.)
4. Update backend configuration for remote state
5. Configure your .NET application with the output values
