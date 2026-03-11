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

variable "google_oauth_client_id" {
  description = "Google OAuth 2.0 Client ID (used by GIS on the frontend and GoogleTokenValidator on the API)."
  type        = string
}

variable "google_oauth_client_secret" {
  description = "Google OAuth 2.0 Client Secret. No longer required for in-process JWT validation; kept for backwards compatibility."
  type        = string
  sensitive   = true
  default     = ""
}

variable "swa_repository_url" {
  description = "Repository URL for the Static Web App (used to enable custom auth/providers)."
  type        = string
}

variable "swa_repository_branch" {
  description = "Branch to watch for Static Web App deployments."
  type        = string
  default     = "main"
}

variable "swa_repository_token" {
  description = "Repository token for the Static Web App (GitHub PAT or deployment token)."
  type        = string
  sensitive   = true
}

variable "segmentation_endpoint_url" {
  description = "HTTP endpoint URL for the Modal BiRefNet segmentation service."
  type        = string
  default     = ""
}

variable "segmentation_shared_token" {
  description = "Shared bearer token for the Modal BiRefNet segmentation service."
  type        = string
  sensitive   = true
  default     = ""
}

variable "admin_user_ids" {
  description = "Comma-separated list of Google User IDs with administrative privileges."
  type        = string
  default     = ""
}

variable "grafana_cloud_otlp_endpoint" {
  description = "OTLP ingest endpoint for Grafana Cloud (for example, https://otlp-gateway-<region>.grafana.net/otlp)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "grafana_cloud_otlp_headers" {
  description = "Authorization header payload for Grafana OTLP ingestion, eg: 'Authorization=Basic <base64(id:token)>'."
  type        = string
  sensitive   = true
  default     = ""
}

variable "grafana_cloud_processor_service_name" {
  description = "Service name for the Python processor Function App in Grafana."
  type        = string
  default     = "pluckit-prod-processor-func"
}
