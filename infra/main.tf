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

  identity {
    type = "SystemAssigned"
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

# Queue for async image processing jobs — placed on the same storage account as blobs.
# Azure Storage Queues have no baseline cost (free tier covers ~70K ops/month; charges
# kick in at $0.00004 per additional 10K operations, negligible at this scale).
resource "azurerm_storage_queue" "image_processing_jobs" {
  name                 = "image-processing-jobs"
  storage_account_name = azurerm_storage_account.sa_pluckit.name
}

resource "azurerm_storage_queue" "taste_analysis_jobs" {
  name                 = "taste-analysis-jobs"
  storage_account_name = azurerm_storage_account.sa_pluckit.name
}

resource "azurerm_storage_queue" "taste_analysis_jobs_poison" {
  name                 = "taste-analysis-jobs-poison"
  storage_account_name = azurerm_storage_account.sa_pluckit.name
}

resource "azurerm_cosmosdb_account" "pluckit" {
  name                = "${local.base_name}-cosmos"
  location            = azurerm_resource_group.rg_pluckit_archive.location
  resource_group_name = azurerm_resource_group.rg_pluckit_archive.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  identity {
    type = "SystemAssigned"
  }

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

  # Shared throughput pool: all containers inherit these RU/s.
  # 1000 RU/s is fully covered by the Cosmos DB free tier, so billed cost = $0.
  throughput = 1000
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

    # Cover all scalar paths (default wildcard)
    included_path {
      path = "/*"
    }

    # Explicit range indexes for the sort/filter paths that may not be reached
    # by the wildcard when nested (Cosmos guarantees nested paths for /* but
    # explicit entries ensure index is present after any future schema changes).
    included_path { path = "/dateAdded/?" }
    included_path { path = "/wearCount/?" }
    included_path { path = "/price/amount/?" }
    included_path { path = "/brand/?" }
    included_path { path = "/condition/?" }
    included_path { path = "/lastWornAt/?" }

    # Composite indexes — required for efficient ORDER BY when combined with
    # range filters inside a partition.  Each group covers one sort dimension.

    # Sort by most recently added
    composite_index {
      index {
        path  = "/dateAdded"
        order = "descending"
      }
      index {
        path  = "/id"
        order = "ascending"
      }
    }

    # Sort by oldest first
    composite_index {
      index {
        path  = "/dateAdded"
        order = "ascending"
      }
      index {
        path  = "/id"
        order = "ascending"
      }
    }

    # Sort by most worn (descending)
    composite_index {
      index {
        path  = "/wearCount"
        order = "descending"
      }
      index {
        path  = "/id"
        order = "ascending"
      }
    }

    # Sort by most worn (ascending — cheapest first / least worn)
    composite_index {
      index {
        path  = "/wearCount"
        order = "ascending"
      }
      index {
        path  = "/id"
        order = "ascending"
      }
    }

    # Sort by price descending (most expensive first)
    composite_index {
      index {
        path  = "/price/amount"
        order = "descending"
      }
      index {
        path  = "/id"
        order = "ascending"
      }
    }

    # Sort by price ascending (cheapest first)
    composite_index {
      index {
        path  = "/price/amount"
        order = "ascending"
      }
      index {
        path  = "/id"
        order = "ascending"
      }
    }

    # Sort by most recently worn
    composite_index {
      index {
        path  = "/lastWornAt"
        order = "descending"
      }
      index {
        path  = "/id"
        order = "ascending"
      }
    }

    # Sort by least recently worn (re-wear cadence analysis)
    composite_index {
      index {
        path  = "/lastWornAt"
        order = "ascending"
      }
      index {
        path  = "/id"
        order = "ascending"
      }
    }
  }
}

# Stores refresh/access/ID tokens used for mobile auth session exchange.
resource "azurerm_cosmosdb_sql_container" "refresh_tokens" {
  name                  = "RefreshTokens"
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

# Full wear-event history (append-only). Partitioned by user for cheap
# per-user history scans and per-item timeline queries.
resource "azurerm_cosmosdb_sql_container" "wear_events" {
  name                  = "WearEvents"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/userId"]
  partition_key_version = 1

  indexing_policy {
    indexing_mode = "consistent"

    included_path { path = "/*" }
    included_path { path = "/itemId/?" }
    included_path { path = "/occurredAt/?" }
    included_path { path = "/source/?" }

    composite_index {
      index {
        path  = "/itemId"
        order = "ascending"
      }
      index {
        path  = "/occurredAt"
        order = "descending"
      }
    }
  }
}

# Styling activity + wear-suggestion lifecycle.
resource "azurerm_cosmosdb_sql_container" "styling_activity" {
  name                  = "StylingActivity"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/userId"]
  partition_key_version = 1
  default_ttl           = 7776000 # 90 days

  indexing_policy {
    indexing_mode = "consistent"

    included_path { path = "/*" }
    included_path { path = "/itemId/?" }
    included_path { path = "/status/?" }
    included_path { path = "/occurredAt/?" }
    included_path { path = "/clientEventId/?" }

    composite_index {
      index {
        path  = "/status"
        order = "ascending"
      }
      index {
        path  = "/occurredAt"
        order = "descending"
      }
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

# Cache for short-lived vault insights payloads (deduplicates repeated expensive reads).
resource "azurerm_cosmosdb_sql_container" "vault_insights_cache" {
  name                  = "VaultInsightsCache"
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

    included_path {
      path = "/userId/?"
    }
    included_path {
      path = "/generatedAt/?"
    }
    included_path {
      path = "/expiresAt/?"
    }
  }
}

# Stores per-user conversation memory: rolling summary + last-digest wardrobe hash.
# TTL of 30 days auto-expires stale summaries.
resource "azurerm_cosmosdb_sql_container" "conversations" {
  name                  = "Conversations"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/userId"]
  partition_key_version = 1
  default_ttl           = 2592000 # 30 days in seconds

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

# Partition key = ownerId so all of a user's owned collections are co-located.
# A separate cross-partition query fetches collections where the user is a member.
resource "azurerm_cosmosdb_sql_container" "collections" {
  name                  = "Collections"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/ownerId"]
  partition_key_version = 1

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }

    # Composite index to efficiently query "collections I joined" across all partitions
    composite_index {
      index {
        path  = "/memberUserIds"
        order = "Ascending"
      }
      index {
        path  = "/createdAt"
        order = "Descending"
      }
    }
  }
}

# Stores fashion trend moods extracted daily from RSS feeds.
# Partition key is /primaryMood to allow efficient filtering by mood category.
resource "azurerm_cosmosdb_sql_container" "moods" {
  name                  = "Moods"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/primaryMood"]
  partition_key_version = 1

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }
  }
}

# Stores thumbs-up / thumbs-down feedback on digest purchase suggestions.
# TTL of 90 days keeps feedback relevant and bounds container growth.
# Partition key = /userId so all feedback for one user is co-located.
resource "azurerm_cosmosdb_sql_container" "digest_feedback" {
  name                  = "DigestFeedback"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/userId"]
  partition_key_version = 1
  default_ttl           = 7776000 # 90 days in seconds

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }

    # Efficient fetch of all feedback for a specific digest id within a user partition
    composite_index {
      index {
        path  = "/digestId"
        order = "ascending"
      }
      index {
        path  = "/createdAt"
        order = "descending"
      }
    }
  }
}

# ── Scraper containers ────────────────────────────────────────────────────────
# ScraperSources: catalog of global and user-created scraper sources.
# Partitioned by /sourceType (reddit | brand_site | pinterest).
# No TTL — source configs are long-lived.
resource "azurerm_cosmosdb_sql_container" "scraper_sources" {
  name                  = "ScraperSources"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/sourceType"]
  partition_key_version = 1

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }

    composite_index {
      index {
        path  = "/isGlobal"
        order = "ascending"
      }
      index {
        path  = "/isActive"
        order = "ascending"
      }
    }
  }
}

# ScrapedItems: scraped outfit/product items with embeddings.
# Partitioned by /userId ("global" for shared sources, userId for personal).
# TTL of 30 days bounds storage cost — old items age out automatically.
resource "azurerm_cosmosdb_sql_container" "scraped_items" {
  name                  = "ScrapedItems"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/userId"]
  partition_key_version = 1
  default_ttl           = 2592000 # 30 days in seconds

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }

    # Efficient dedup lookups and chronological feed queries
    composite_index {
      index {
        path  = "/userId"
        order = "ascending"
      }
      index {
        path  = "/scrapedAt"
        order = "descending"
      }
    }
    composite_index {
      index {
        path  = "/userId"
        order = "ascending"
      }
      index {
        path  = "/scoreSignal"
        order = "descending"
      }
    }
    composite_index {
      index {
        path  = "/userId"
        order = "ascending"
      }
      index {
        path  = "/pHash"
        order = "ascending"
      }
    }
  }
}

resource "azurerm_cosmosdb_sql_container" "taste_analysis_jobs" {
  name                  = "TasteAnalysisJobs"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/jobId"]
  partition_key_version = 1
  default_ttl           = 1209600 # 14 days in seconds

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }

    included_path { path = "/jobId/?" }
    included_path { path = "/userId/?" }
    included_path { path = "/status/?" }
    included_path { path = "/createdAt/?" }
    included_path { path = "/updatedAt/?" }
    included_path { path = "/retryCount/?" }
  }
}

resource "azurerm_cosmosdb_sql_container" "taste_analysis_job_dead_letters" {
  name                  = "TasteAnalysisJobDeadLetters"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/jobId"]
  partition_key_version = 1
  default_ttl           = 2592000 # 30 days in seconds

  indexing_policy {
    indexing_mode = "consistent"

    included_path {
      path = "/*"
    }

    included_path { path = "/jobId/?" }
    included_path { path = "/userId/?" }
    included_path { path = "/status/?" }
    included_path { path = "/createdAt/?" }
  }
}

# UserSourceSubscriptions: which sources each user has subscribed to.
# Partitioned by /userId for fast per-user subscription lookups.
resource "azurerm_cosmosdb_sql_container" "user_source_subscriptions" {
  name                  = "UserSourceSubscriptions"
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

    composite_index {
      index {
        path  = "/userId"
        order = "ascending"
      }
      index {
        path  = "/isActive"
        order = "ascending"
      }
    }
  }
}

# TasteCalibration: style quiz sessions and inferred taste profiles.
# Partitioned by /userId. No TTL — quiz results are long-lived profile data.
resource "azurerm_cosmosdb_sql_container" "taste_calibration" {
  name                  = "TasteCalibration"
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

    composite_index {
      index {
        path  = "/userId"
        order = "ascending"
      }
      index {
        path  = "/isComplete"
        order = "ascending"
      }
      index {
        path  = "/createdAt"
        order = "descending"
      }
    }
  }
}

# UserBans: persistent list of users banned from contributing to the scraper.
# Partitioned by /id (userId).
resource "azurerm_cosmosdb_sql_container" "user_bans" {
  name                  = "UserBans"
  resource_group_name   = azurerm_resource_group.rg_pluckit_archive.name
  account_name          = azurerm_cosmosdb_account.pluckit.name
  database_name         = azurerm_cosmosdb_sql_database.pluckit.name
  partition_key_paths   = ["/id"]
  partition_key_version = 1
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

  identity {
    type = "SystemAssigned"
  }
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

  # On-demand only — no always-ready instances. Saves ~$50-60/month.
  # Expect a cold start of ~2-5 s on the first request after idle.
  instance_memory_in_mb = 2048

  site_config {
    cors {
      allowed_origins     = var.cors_allowed_origins
      support_credentials = true
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
    "FUNCTIONS_EXTENSION_VERSION"           = "~4"
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.pluckit.connection_string
    "OTEL_EXPORTER_OTLP_ENDPOINT"                   = var.grafana_cloud_otlp_endpoint
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"            = "${var.grafana_cloud_otlp_endpoint}/v1/traces"
    "OTEL_EXPORTER_OTLP_HEADERS"                    = var.grafana_cloud_otlp_headers
    "OTEL_EXPORTER_OTLP_PROTOCOL"                   = "http/protobuf"
    "OTEL_TRACES_EXPORTER"                          = "otlp"
    "OTEL_METRICS_EXPORTER"                         = "otlp"
    "OTEL_LOGS_EXPORTER"                            = "otlp"
    "OTEL_SERVICE_NAME"                             = var.grafana_cloud_api_service_name
    "Cosmos__Endpoint"                      = azurerm_cosmosdb_account.pluckit.endpoint
    "Cosmos__Key"                           = azurerm_cosmosdb_account.pluckit.primary_key
    "Cosmos__Database"                      = azurerm_cosmosdb_sql_database.pluckit.name
    "Cosmos__Container"                     = azurerm_cosmosdb_sql_container.wardrobe.name
    "Cosmos__RefreshTokensContainer"        = azurerm_cosmosdb_sql_container.refresh_tokens.name
    "Cosmos__WearEventsContainer"           = azurerm_cosmosdb_sql_container.wear_events.name
    "Cosmos__StylingActivityContainer"      = azurerm_cosmosdb_sql_container.styling_activity.name
    "Cosmos__UserProfilesContainer"         = azurerm_cosmosdb_sql_container.user_profiles.name
    "AI__Endpoint"                          = var.ai_gpt4o_endpoint
    "AI__ApiKey"                            = var.ai_api_key
    "AI__Deployment"                        = "gpt-4.1-mini"
    "BlobStorage__AccountName"              = azurerm_storage_account.sa_pluckit.name
    "BlobStorage__AccountKey"               = azurerm_storage_account.sa_pluckit.primary_access_key
    "BlobStorage__ArchiveContainer"         = azurerm_storage_container.archive.name
    "BlobStorage__UploadsContainer"         = azurerm_storage_container.uploads.name
    "Processor__BaseUrl"                    = "https://${local.base_name}-processor-func.azurewebsites.net"
    # Storage Queue connection for the image-processing-jobs queue trigger + enqueue client.
    # The queue lives on sa_pluckit (same account as archive/uploads blobs).
    "StorageQueue" = "DefaultEndpointsProtocol=https;AccountName=${azurerm_storage_account.sa_pluckit.name};AccountKey=${azurerm_storage_account.sa_pluckit.primary_access_key};EndpointSuffix=core.windows.net"
    # Google OAuth Client ID — used by GoogleTokenValidator to verify GIS ID tokens.
    # The client secret is NOT needed; verification uses Google's public JWKS only.
    "GoogleAuth__ClientId"         = var.google_oauth_client_id
    "GoogleAuth__AllowedClientIds" = var.google_oauth_allowed_client_ids
    "FEATURE_WEAR_SUGGESTIONS"     = "true"
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
  location = "eastasia"
  # Free tier — the SWA is now a plain static host; Google auth is handled
  # entirely in the browser via GIS and verified in the API Function App.
  sku_tier = "Free"
  sku_size = "Free"

  # Linking the repo allows the portal to show deployment history
  repository_url    = var.swa_repository_url
  repository_branch = var.swa_repository_branch
  repository_token  = var.swa_repository_token
}

resource "azurerm_static_web_app_custom_domain" "pluckit_domain" {
  static_web_app_id = azurerm_static_web_app.frontend.id
  domain_name       = "pluckit.omakashay.com"
  validation_type   = "dns-txt-token"
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
      support_credentials = true
    }
  }

  lifecycle {
    ignore_changes = [auth_settings_v2]
  }

  app_settings = {
    "FUNCTIONS_EXTENSION_VERSION"                   = "~4"
    "APPLICATIONINSIGHTS_CONNECTION_STRING"         = azurerm_application_insights.pluckit.connection_string
    "OTEL_EXPORTER_OTLP_ENDPOINT"                   = var.grafana_cloud_otlp_endpoint
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"            = "${var.grafana_cloud_otlp_endpoint}/v1/traces"
    "OTEL_EXPORTER_OTLP_HEADERS"                    = var.grafana_cloud_otlp_headers
    "OTEL_EXPORTER_OTLP_PROTOCOL"                   = "http/protobuf"
    "OTEL_TRACES_EXPORTER"                          = "otlp"
    "OTEL_METRICS_EXPORTER"                         = "otlp"
    "OTEL_LOGS_EXPORTER"                            = "otlp"
    "OTEL_SERVICE_NAME"                             = var.grafana_cloud_processor_service_name
    "UPLOADS_CONTAINER_NAME"                        = azurerm_storage_container.uploads.name
    "ARCHIVE_CONTAINER_NAME"                        = azurerm_storage_container.archive.name
    "STORAGE_ACCOUNT_NAME"                          = azurerm_storage_account.sa_pluckit.name
    "STORAGE_ACCOUNT_KEY"                           = azurerm_storage_account.sa_pluckit.primary_access_key
    "StorageQueue"                                  = "DefaultEndpointsProtocol=https;AccountName=${azurerm_storage_account.sa_pluckit.name};AccountKey=${azurerm_storage_account.sa_pluckit.primary_access_key};EndpointSuffix=core.windows.net"
    "COSMOS_DB_ENDPOINT"                            = azurerm_cosmosdb_account.pluckit.endpoint
    "COSMOS_DB_KEY"                                 = azurerm_cosmosdb_account.pluckit.primary_key
    "COSMOS_DB_DATABASE"                            = azurerm_cosmosdb_sql_database.pluckit.name
    "COSMOS_DB_CONTAINER"                           = azurerm_cosmosdb_sql_container.wardrobe.name
    "COSMOS_DB_REFRESH_TOKENS_CONTAINER"            = azurerm_cosmosdb_sql_container.refresh_tokens.name
    "COSMOS_DB_WEAR_EVENTS_CONTAINER"               = azurerm_cosmosdb_sql_container.wear_events.name
    "COSMOS_DB_STYLING_ACTIVITY_CONTAINER"          = azurerm_cosmosdb_sql_container.styling_activity.name
    "COSMOS_DB_USER_PROFILES_CONTAINER"             = azurerm_cosmosdb_sql_container.user_profiles.name
    "COSMOS_DB_CONVERSATIONS_CONTAINER"             = azurerm_cosmosdb_sql_container.conversations.name
    "COSMOS_DB_DIGESTS_CONTAINER"                   = azurerm_cosmosdb_sql_container.digests.name
    "COSMOS_DB_MOODS_CONTAINER"                     = azurerm_cosmosdb_sql_container.moods.name
    "COSMOS_DB_DIGEST_FEEDBACK_CONTAINER"           = azurerm_cosmosdb_sql_container.digest_feedback.name
    "COSMOS_DB_SCRAPER_SOURCES_CONTAINER"           = azurerm_cosmosdb_sql_container.scraper_sources.name
    "COSMOS_DB_SCRAPED_ITEMS_CONTAINER"             = azurerm_cosmosdb_sql_container.scraped_items.name
    "COSMOS_DB_USER_SOURCE_SUBSCRIPTIONS_CONTAINER" = azurerm_cosmosdb_sql_container.user_source_subscriptions.name
    "COSMOS_DB_TASTE_CALIBRATION_CONTAINER"         = azurerm_cosmosdb_sql_container.taste_calibration.name
    "COSMOS_DB_TASTE_JOBS_CONTAINER"                = azurerm_cosmosdb_sql_container.taste_analysis_jobs.name
    "COSMOS_DB_TASTE_JOB_DEAD_LETTER_CONTAINER"     = azurerm_cosmosdb_sql_container.taste_analysis_job_dead_letters.name
    "TASTE_JOB_QUEUE_NAME"                          = "taste-analysis-jobs"
    "TASTE_JOB_DEAD_LETTER_QUEUE_NAME"              = "taste-analysis-jobs-poison"
    "COSMOS_DB_USER_BANS_CONTAINER"                 = azurerm_cosmosdb_sql_container.user_bans.name
    "COSMOS_DB_VAULT_INSIGHTS_CACHE_CONTAINER"      = azurerm_cosmosdb_sql_container.vault_insights_cache.name
    "COSMOS_DB_VAULT_INSIGHTS_CACHE_TTL_MS"         = "300000"
    # Azure OpenAI — primary model for chat/agents
    "AZURE_OPENAI_ENDPOINT"   = var.ai_gpt4o_endpoint
    "AZURE_OPENAI_API_KEY"    = var.ai_api_key
    "AZURE_OPENAI_DEPLOYMENT" = "gpt-4.1-mini"
    # Embedding model for mood name canonicalization (cross-run dedup)
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT" = "text-embedding-3-small"
    # Google OAuth client ID — used to validate bearer tokens from Angular
    "GOOGLE_CLIENT_ID"          = var.google_oauth_client_id
    "GOOGLE_ALLOWED_CLIENT_IDS" = var.google_oauth_allowed_client_ids
    "ADMIN_USER_IDS"            = var.admin_user_ids
    "CORS_ALLOWED_ORIGINS"      = join(",", var.cors_allowed_origins)
    "FEATURE_VAULT_INSIGHTS"    = "true"
    "LANGFUSE_PUBLIC_KEY"       = var.langfuse_public_key
    "LANGFUSE_SECRET_KEY"       = var.langfuse_secret_key
    "LANGFUSE_HOST"             = var.langfuse_host
    "SEGMENTATION_ENDPOINT_URL" = var.segmentation_endpoint_url
    "SEGMENTATION_SHARED_TOKEN" = var.segmentation_shared_token
  }
}
