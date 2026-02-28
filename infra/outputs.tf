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

output "api_func_url" {
  description = "Default hostname for the PluckIt .NET Functions API."
  value       = azurerm_function_app_flex_consumption.pluckit_api.default_hostname
}

output "function_app_name" {
  description = "Name of the Pluck-It processor Function App."
  value       = azurerm_function_app_flex_consumption.pluckit_processor.name
}

output "vision_endpoint" {
  description = "Azure Computer Vision endpoint for background removal."
  value       = azurerm_cognitive_account.vision.endpoint
}

