# Backend configuration
# Initially using local backend for first apply
# After infrastructure is created, uncomment azurerm backend and run: terraform init -migrate-state

terraform {
  backend "local" {
    path = "terraform.tfstate"
  }
}

# Uncomment after first successful apply to migrate to Azure remote state:
# terraform {
#   backend "azurerm" {
#     resource_group_name  = "PluckIt-RG"
#     storage_account_name = "pluckitprodsa8dedj4"
#     container_name       = "tfstate"
#     key                  = "infra.tfstate"
#   }
# }

