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
  storage_account_name  = azurerm_storage_account.sa_pluckit.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "archive" {
  name                  = "archive"
  storage_account_name  = azurerm_storage_account.sa_pluckit.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_name  = azurerm_storage_account.sa_pluckit.name
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
  partition_key_paths   = ["/id"]
  partition_key_version = 1

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }
  }
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
  storage_account_name  = azurerm_storage_account.sa_functions.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "proc_func_deployment" {
  name                  = "proc-func-deploy"
  storage_account_name  = azurerm_storage_account.sa_functions.name
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
  storage_container_endpoint  = "${azurerm_storage_account.sa_functions.primary_blob_endpoint}${azurerm_storage_container.api_func_deployment.name}"
  storage_authentication_type = "StorageAccountConnectionString"
  storage_access_key          = azurerm_storage_account.sa_functions.primary_access_key

  runtime_name    = "dotnet-isolated"
  runtime_version = "10.0"

  instance_memory_in_mb  = 2048
  # 1 always-ready instance prevents cold starts; ~$8-9/month
  minimum_instance_count = 1

  site_config {
    cors {
      allowed_origins    = var.cors_allowed_origins
      support_credentials = false
    }
  }

  app_settings = {
    "FUNCTIONS_EXTENSION_VERSION"   = "~4"
    "Cosmos__Endpoint"              = azurerm_cosmosdb_account.pluckit.endpoint
    "Cosmos__Key"                   = azurerm_cosmosdb_account.pluckit.primary_key
    "Cosmos__Database"              = azurerm_cosmosdb_sql_database.pluckit.name
    "Cosmos__Container"             = azurerm_cosmosdb_sql_container.wardrobe.name
    "AI__Endpoint"                  = var.ai_gpt4o_endpoint
    "AI__ApiKey"                    = var.ai_api_key
    "AI__Deployment"                = "gpt-4.1-mini"
    "BlobStorage__AccountName"      = azurerm_storage_account.sa_pluckit.name
    "BlobStorage__AccountKey"       = azurerm_storage_account.sa_pluckit.primary_access_key
    "BlobStorage__ArchiveContainer" = azurerm_storage_container.archive.name
    "Processor__BaseUrl"            = "https://${local.base_name}-processor-func.azurewebsites.net"
  }
}

# ── Python Processor — Flex Consumption ─────────────────────────────────────
# NOTE: The blob trigger (PluckItBlobProcessor) must be migrated to an Event Grid
# source trigger for Flex Consumption — polling blob triggers are not supported.
# The HTTP trigger (PluckItProcessImage) works without changes.

resource "azurerm_service_plan" "functions_plan" {
  name                = "${local.base_name}-func-plan"
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

  storage_container_endpoint  = "${azurerm_storage_account.sa_functions.primary_blob_endpoint}${azurerm_storage_container.proc_func_deployment.name}"
  storage_authentication_type = "StorageAccountConnectionString"
  storage_access_key          = azurerm_storage_account.sa_functions.primary_access_key

  runtime_name    = "python"
  runtime_version = "3.12"

  instance_memory_in_mb = 2048

  site_config {}

  app_settings = {
    "FUNCTIONS_EXTENSION_VERSION" = "~4"
    "FUNCTIONS_WORKER_RUNTIME"    = "python"
    "UPLOADS_CONTAINER_NAME"      = azurerm_storage_container.uploads.name
    "ARCHIVE_CONTAINER_NAME"      = azurerm_storage_container.archive.name
    "STORAGE_ACCOUNT_NAME"        = azurerm_storage_account.sa_pluckit.name
    "STORAGE_ACCOUNT_KEY"         = azurerm_storage_account.sa_pluckit.primary_access_key
    "COSMOS_DB_ENDPOINT"          = azurerm_cosmosdb_account.pluckit.endpoint
    "COSMOS_DB_KEY"               = azurerm_cosmosdb_account.pluckit.primary_key
    "COSMOS_DB_DATABASE"          = azurerm_cosmosdb_sql_database.pluckit.name
    "COSMOS_DB_CONTAINER"         = azurerm_cosmosdb_sql_container.wardrobe.name
  }
}

