# Backend configuration
# Using Azure remote state for consistent state across local and CI/CD

terraform {
  backend "azurerm" {
    resource_group_name  = "PluckIt-RG"
    storage_account_name = "pluckitprodsa8dedj4"
    container_name       = "tfstate"
    key                  = "infra.tfstate"
  }
}

