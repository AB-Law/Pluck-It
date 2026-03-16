output "resource_group_name" {
  description = "Name of the resource group."
  value       = azurerm_resource_group.rg_pluckit_archive.name
}

output "storage_account_name" {
  description = "Name of the storage account for uploads/archive."
  value       = azurerm_storage_account.sa_pluckit.name
}

output "uploads_container_name" {
  description = "Blob container name for uploads."
  value       = azurerm_storage_container.uploads.name
}

output "archive_container_name" {
  description = "Blob container name for processed images."
  value       = azurerm_storage_container.archive.name
}

output "cosmos_endpoint" {
  description = "Cosmos DB endpoint URL."
  value       = azurerm_cosmosdb_account.pluckit.endpoint
}

output "cosmos_database_name" {
  description = "Cosmos DB database name."
  value       = azurerm_cosmosdb_sql_database.pluckit.name
}

output "cosmos_container_name" {
  description = "Cosmos DB container name for wardrobe items."
  value       = azurerm_cosmosdb_sql_container.wardrobe.name
}

output "cosmos_image_cleanup_index_container_name" {
  description = "Cosmos DB container name for wardrobe image cleanup index."
  value       = azurerm_cosmosdb_sql_container.wardrobe_image_cleanup_index.name
}

output "cosmos_vault_insights_cache_container_name" {
  description = "Cosmos DB container name for cached vault insight responses."
  value       = azurerm_cosmosdb_sql_container.vault_insights_cache.name
}

output "cosmos_moods_container_name" {
  description = "Cosmos DB container name for fashion trend moods."
  value       = azurerm_cosmosdb_sql_container.moods.name
}

output "api_func_url" {
  description = "Default hostname for the PluckIt .NET Functions API."
  value       = azurerm_function_app_flex_consumption.pluckit_api.default_hostname
}

output "function_app_name" {
  description = "Name of the Pluck-It processor Function App."
  value       = azurerm_function_app_flex_consumption.pluckit_processor.name
}

output "app_insights_connection_string" {
  description = "Application Insights connection string. Copy into local.settings.json for local debugging."
  value       = azurerm_application_insights.pluckit.connection_string
  sensitive   = true
}

output "app_insights_name" {
  description = "Name of the Application Insights resource."
  value       = azurerm_application_insights.pluckit.name
}

output "swa_default_hostname" {
  description = "Default hostname of the Static Web App (use as CNAME target)."
  value       = azurerm_static_web_app.frontend.default_host_name
}

output "swa_domain_validation_token" {
  description = "TXT token for custom domain DNS validation — add as _dnsauth.pluckit TXT record in Cloudflare."
  value       = azurerm_static_web_app_custom_domain.pluckit_domain.validation_token
  sensitive   = true
}



