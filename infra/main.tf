locals {
  base_name = "${var.project_name}-${var.environment}"
}

import {
  to = azurerm_resource_group.rg_pluckit_archive
  id = "/subscriptions/72101efc-f7f6-42bd-a6f6-f892771aacbf/resourceGroups/PluckIt-RG"
}

resource "azurerm_resource_group" "rg_pluckit_archive" {
  name     = "PluckIt-RG"
  location = var.location
}

resource "random_string" "storage_suffix" {
  length  = 6
  upper   = false
  numeric = true
  special = false
}

resource "azurerm_storage_account" "sa_pluckit" {
  name                     = replace("${local.base_name}sa${random_string.storage_suffix.result}", "-", "")
  resource_group_name      = azurerm_resource_group.rg_pluckit_archive.name
  location                 = azurerm_resource_group.rg_pluckit_archive.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"

  blob_properties {
    versioning_enabled = true
  }
}

resource "azurerm_storage_container" "uploads" {
  name                  = "uploads"
  storage_account_id    = azurerm_storage_account.sa_pluckit.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "archive" {
  name                  = "archive"
  storage_account_id    = azurerm_storage_account.sa_pluckit.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.sa_pluckit.id
  container_access_type = "private"
}

resource "azurerm_cosmosdb_account" "pluckit" {
  name                = "${local.base_name}-cosmos"
  location            = azurerm_resource_group.rg_pluckit_archive.location
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  # Free tier - only one per subscription
  free_tier_enabled = true

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = azurerm_resource_group.rg_pluckit_archive.location
    failover_priority = 0
  }
}

resource "azurerm_cosmosdb_sql_database" "pluckit" {
  name                = "PluckIt"
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  account_name        = azurerm_cosmosdb_account.pluckit.name
}

resource "azurerm_cosmosdb_sql_container" "wardrobe" {
  name                  = "Wardrobe"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/userId"]
  partition_key_version = 1

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }
  }
}

resource "azurerm_cosmosdb_sql_container" "user_profiles" {
  name                  = "UserProfiles"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/id"]
  partition_key_version = 1

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }
  }
}

# Stores per-user conversation memory: rolling summary + last-digest wardrobe hash.
# TTL of 30 days auto-expires stale summaries.
resource "azurerm_cosmosdb_sql_container" "conversations" {
  name                   = "Conversations"
  resource_group_name    = azurerm_resource_group.rg_pluckit_archive.name
  account_name           = azurerm_cosmosdb_account.pluckit.name
  database_name          = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths    = ["/userId"]
  partition_key_version  = 1
  default_ttl            = 2592000 # 30 days in seconds

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }
  }
}

# Stores weekly/daily wardrobe digest results (purchase suggestions).
# Subscription gating can be layered on top later.
resource "azurerm_cosmosdb_sql_container" "digests" {
  name                  = "Digests"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/userId"]
  partition_key_version = 1

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }
  }
}

# ── Logging: Log Analytics Workspace + Application Insights ─────────────────
# Free tier: 500 MB/day on Log Analytics; first 5 GB/month free on App Insights.

resource "azurerm_log_analytics_workspace" "pluckit" {
  name                = "${local.base_name}-logs"
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  location            = azurerm_resource_group.rg_pluckit_archive.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_application_insights" "pluckit" {
  name                = "${local.base_name}-appinsights"
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  location            = azurerm_resource_group.rg_pluckit_archive.location
  workspace_id        = azurerm_log_analytics_workspace.pluckit.id
  application_type    = "web"
}

# ── Shared Functions storage account (used for both Function App deployments) ──

resource "azurerm_storage_account" "sa_functions" {
  name                     = replace("${local.base_name}func${random_string.storage_suffix.result}", "-", "")
  resource_group_name      = azurerm_resource_group.rg_pluckit_archive.name
  location                 = azurerm_resource_group.rg_pluckit_archive.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"
}

# Deployment package containers — Flex Consumption requires a dedicated blob container per app

resource "azurerm_storage_container" "api_func_deployment" {
  name                  = "api-func-deploy"
  storage_account_id    = azurerm_storage_account.sa_functions.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "proc_func_deployment" {
  name                  = "proc-func-deploy"
  storage_account_id    = azurerm_storage_account.sa_functions.id
  container_access_type = "private"
}

# ── .NET 10 API — Flex Consumption ──────────────────────────────────────────

resource "azurerm_service_plan" "api_func_plan" {
  name                = "${local.base_name}-api-func-plan"
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  location            = azurerm_resource_group.rg_pluckit_archive.location
  os_type             = "Linux"
  sku_name            = "FC1"
}

resource "azurerm_function_app_flex_consumption" "pluckit_api" {
  name                = "${local.base_name}-api-func"
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  location            = azurerm_resource_group.rg_pluckit_archive.location
  service_plan_id     = azurerm_service_plan.api_func_plan.id

  # Deployment package storage (Flex Consumption uses blob-based deployment, not WEBSITE_RUN_FROM_PACKAGE)
  storage_container_type      = "blobContainer"
  storage_container_endpoint  = "${azurerm_storage_account.sa_functions.primary_blob_endpoint}${azurerm_storage_container.api_func_deployment.name}"
  storage_authentication_type = "StorageAccountConnectionString"
  storage_access_key          = azurerm_storage_account.sa_functions.primary_access_key

  runtime_name    = "dotnet-isolated"
  runtime_version = "10.0"

  instance_memory_in_mb = 2048

  # 1 always-ready instance prevents cold starts; ~$8-9/month
  always_ready {
    name           = "http"
    instance_count = 1
  }

  site_config {
    cors {
      allowed_origins     = var.cors_allowed_origins
      support_credentials = false
    }
  }

  # EasyAuth (auth_settings_v2) is no longer used — the API validates Google ID
  # tokens in-process via GoogleTokenValidator.
  # ignore_changes is required permanently: azurerm_function_app_flex_consumption
  # unconditionally calls PUT authsettingsV2 on every apply, and FC1 rejects that
  # API endpoint with 400 regardless of the payload. This is a provider limitation.
  lifecycle {
    ignore_changes = [auth_settings_v2]
  }

  app_settings = {
    "FUNCTIONS_EXTENSION_VERSION"        = "~4"
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.pluckit.connection_string
    "Cosmos__Endpoint"                   = azurerm_cosmosdb_account.pluckit.endpoint
    "Cosmos__Key"                        = azurerm_cosmosdb_account.pluckit.primary_key
    "Cosmos__Database"                   = azurerm_cosmosdb_sql_database.pluckit.name
    "Cosmos__Container"                  = azurerm_cosmosdb_sql_container.wardrobe.name
    "Cosmos__UserProfilesContainer"      = azurerm_cosmosdb_sql_container.user_profiles.name
    "AI__Endpoint"                       = var.ai_gpt4o_endpoint
    "AI__ApiKey"                         = var.ai_api_key
    "AI__Deployment"                     = "gpt-4.1-mini"
    "BlobStorage__AccountName"           = azurerm_storage_account.sa_pluckit.name
    "BlobStorage__AccountKey"            = azurerm_storage_account.sa_pluckit.primary_access_key
    "BlobStorage__ArchiveContainer"      = azurerm_storage_container.archive.name
    "Processor__BaseUrl"                 = "https://${local.base_name}-processor-func.azurewebsites.net"
    # Google OAuth Client ID — used by GoogleTokenValidator to verify GIS ID tokens.
    # The client secret is NOT needed; verification uses Google's public JWKS only.
    "GoogleAuth__ClientId"               = var.google_oauth_client_id
  }
}

# ── Static Web App (frontend) ────────────────────────────────────────────────
# Import existing SWA: terraform import azurerm_static_web_app.frontend \
#   /subscriptions/72101efc-f7f6-42bd-a6f6-f892771aacbf/resourceGroups/PluckIt-RG/providers/Microsoft.Web/staticSites/pluckit-prod-web

resource "azurerm_static_web_app" "frontend" {
  name                = "pluckit-prod-web"
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  # SWA was originally created in eastasia (different from the resource group region).
  # Hardcoded to prevent destroy+recreate on every plan.
  location            = "eastasia"
  # Free tier — the SWA is now a plain static host; Google auth is handled
  # entirely in the browser via GIS and verified in the API Function App.
  sku_tier            = "Free"
  sku_size            = "Free"

  # Linking the repo allows the portal to show deployment history
  repository_url    = var.swa_repository_url
  repository_branch = var.swa_repository_branch
  repository_token  = var.swa_repository_token
}

# ── Python Processor — Flex Consumption ─────────────────────────────────────
# NOTE: The blob trigger (PluckItBlobProcessor) must be migrated to an Event Grid
# source trigger for Flex Consumption — polling blob triggers are not supported.
# The HTTP trigger (PluckItProcessImage) works without changes.

resource "azurerm_service_plan" "functions_plan" {
  name                = "${local.base_name}-proc-flex-plan"
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  location            = azurerm_resource_group.rg_pluckit_archive.location
  os_type             = "Linux"
  sku_name            = "FC1"
}

resource "azurerm_function_app_flex_consumption" "pluckit_processor" {
  name                = "${local.base_name}-processor-func"
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  location            = azurerm_resource_group.rg_pluckit_archive.location
  service_plan_id     = azurerm_service_plan.functions_plan.id

  storage_container_type      = "blobContainer"
  storage_container_endpoint  = "${azurerm_storage_account.sa_functions.primary_blob_endpoint}${azurerm_storage_container.proc_func_deployment.name}"
  storage_authentication_type = "StorageAccountConnectionString"
  storage_access_key          = azurerm_storage_account.sa_functions.primary_access_key

  runtime_name    = "python"
  runtime_version = "3.12"

  instance_memory_in_mb = 2048

  site_config {
    cors {
      allowed_origins     = var.cors_allowed_origins
      support_credentials = false
    }
  }

  lifecycle {
    ignore_changes = [auth_settings_v2]
  }

  app_settings = {
    "FUNCTIONS_EXTENSION_VERSION"           = "~4"
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.pluckit.connection_string
    "UPLOADS_CONTAINER_NAME"                = azurerm_storage_container.uploads.name
    "ARCHIVE_CONTAINER_NAME"               = azurerm_storage_container.archive.name
    "STORAGE_ACCOUNT_NAME"                 = azurerm_storage_account.sa_pluckit.name
    "STORAGE_ACCOUNT_KEY"                  = azurerm_storage_account.sa_pluckit.primary_access_key
    "COSMOS_DB_ENDPOINT"                   = azurerm_cosmosdb_account.pluckit.endpoint
    "COSMOS_DB_KEY"                        = azurerm_cosmosdb_account.pluckit.primary_key
    "COSMOS_DB_DATABASE"                   = azurerm_cosmosdb_sql_database.pluckit.name
    "COSMOS_DB_CONTAINER"                  = azurerm_cosmosdb_sql_container.wardrobe.name
    "COSMOS_DB_USER_PROFILES_CONTAINER"    = azurerm_cosmosdb_sql_container.user_profiles.name
    "COSMOS_DB_CONVERSATIONS_CONTAINER"    = azurerm_cosmosdb_sql_container.conversations.name
    "COSMOS_DB_DIGESTS_CONTAINER"          = azurerm_cosmosdb_sql_container.digests.name
    # Azure OpenAI — primary model for chat/agents
    "AZURE_OPENAI_ENDPOINT"                = var.ai_gpt4o_endpoint
    "AZURE_OPENAI_API_KEY"                 = var.ai_api_key
    "AZURE_OPENAI_DEPLOYMENT"              = "gpt-4.1-mini"
    # Lighter model used only for conversation summarization (~4x cheaper)
    "AZURE_OPENAI_NANO_DEPLOYMENT"         = var.ai_nano_deployment
    # Google OAuth client ID — used to validate bearer tokens from Angular
    "GOOGLE_CLIENT_ID"                     = var.google_oauth_client_id
  }
}

