locals {
  base_name = "${var.project_name}-${var.environment}"
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
  }
}

resource "azurerm_service_plan" "api_plan" {
  name                = "${local.base_name}-api-plan"
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  location            = azurerm_resource_group.rg_pluckit_archive.location

  os_type  = "Linux"
  sku_name = "B1"
}

resource "azurerm_linux_web_app" "pluckit_api" {
  name                = "${local.base_name}-api"
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  location            = azurerm_resource_group.rg_pluckit_archive.location
  service_plan_id     = azurerm_service_plan.api_plan.id

  site_config {
    always_on = true
  }

  app_settings = {
    "ASPNETCORE_ENVIRONMENT" = var.environment
    "Cosmos__Endpoint"       = azurerm_cosmosdb_account.pluckit.endpoint
    "Cosmos__Key"            = azurerm_cosmosdb_account.pluckit.primary_key
    "Cosmos__Database"       = azurerm_cosmosdb_sql_database.pluckit.name
    "Cosmos__Container"      = azurerm_cosmosdb_sql_container.wardrobe.name
    "AI__Endpoint"           = var.ai_gpt4o_endpoint
    "AI__ApiKey"             = var.ai_api_key
    "AI__Deployment"         = "gpt-4.1-mini"
  }
}

resource "azurerm_storage_account" "sa_functions" {
  name                     = replace("${local.base_name}func${random_string.storage_suffix.result}", "-", "")
  resource_group_name      = azurerm_resource_group.rg_pluckit_archive.name
  location                 = azurerm_resource_group.rg_pluckit_archive.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"
}

resource "azurerm_service_plan" "functions_plan" {
  name                = "${local.base_name}-func-plan"
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  location            = azurerm_resource_group.rg_pluckit_archive.location

  os_type  = "Linux"
  sku_name = "Y1"
}

resource "azurerm_linux_function_app" "pluckit_processor" {
  name                       = "${local.base_name}-processor-func"
  resource_group_name        = azurerm_resource_group.rg_pluckit_archive.name
  location                   = azurerm_resource_group.rg_pluckit_archive.location
  service_plan_id            = azurerm_service_plan.functions_plan.id
  storage_account_name       = azurerm_storage_account.sa_functions.name
  storage_account_access_key = azurerm_storage_account.sa_functions.primary_access_key

  site_config {
    application_stack {
      python_version = "3.13"
    }
  }

  app_settings = {
    "AzureWebJobsStorage"         = azurerm_storage_account.sa_functions.primary_connection_string
    "FUNCTIONS_EXTENSION_VERSION" = "~4"
    "FUNCTIONS_WORKER_RUNTIME"    = "python"
    "UPLOADS_CONTAINER_NAME"      = azurerm_storage_container.uploads.name
    "ARCHIVE_CONTAINER_NAME"      = azurerm_storage_container.archive.name
    "STORAGE_ACCOUNT_NAME"        = azurerm_storage_account.sa_pluckit.name
    "COSMOS_DB_ENDPOINT"          = azurerm_cosmosdb_account.pluckit.endpoint
    "COSMOS_DB_KEY"               = azurerm_cosmosdb_account.pluckit.primary_key
    "COSMOS_DB_DATABASE"          = azurerm_cosmosdb_sql_database.pluckit.name
    "COSMOS_DB_CONTAINER"         = azurerm_cosmosdb_sql_container.wardrobe.name
  }
}

