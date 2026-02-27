variable "subscription_id" {
  description = "Azure subscription ID to deploy into."
  type        = string
}

variable "location" {
  description = "Azure region for all resources (e.g. westeurope, eastus2)."
  type        = string
}

variable "project_name" {
  description = "Short project name used as a naming prefix."
  type        = string
  default     = "pluckit"
}

variable "environment" {
  description = "Environment name used in resource naming (e.g. dev, prod)."
  type        = string
  default     = "prod"
}

variable "ai_gpt4o_endpoint" {
  description = "HTTPS endpoint URL for the GPT-4.1-mini serverless deployment."
  type        = string
}

variable "ai_api_key" {
  description = "API key for Azure AI Inference / Azure OpenAI (GPT-4.1-mini)."
  type        = string
  sensitive   = true
}

variable "cors_allowed_origins" {
  description = "Array of allowed CORS origins for the API."
  type        = list(string)
  default     = []
}

