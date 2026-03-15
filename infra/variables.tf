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

variable "google_oauth_allowed_client_ids" {
  description = "Comma- or semicolon-separated Google OAuth 2.0 Client IDs allowed by token validators."
  type        = string
  default     = ""
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

variable "metadata_extract_endpoint_url" {
  description = "Full URL of the Python metadata extraction endpoint."
  type        = string
  default     = ""
}

variable "metadata_extract_auth_mode" {
  description = "Metadata auth mode: api-key or azureAd."
  type        = string
  default     = "api-key"
}

variable "metadata_extract_api_key" {
  description = "Shared API key for local/dev mode metadata endpoint auth."
  type        = string
  sensitive   = true
  default     = ""
}

variable "metadata_extract_azure_ad_scope" {
  description = "Azure AD scope for metadata endpoint token retrieval when auth mode is azureAd."
  type        = string
  default     = ""
  sensitive   = true
}

variable "metadata_extract_azure_ad_audience" {
  description = "Fallback Azure AD audience used to construct scope when scope is not set."
  type        = string
  default     = ""
}

variable "metadata_extract_azure_ad_issuer" {
  description = "Optional Azure AD token issuer validation value for metadata endpoint (python side)."
  type        = string
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

variable "grafana_cloud_api_service_name" {
  description = "Service name for the .NET API Function App in Grafana."
  type        = string
  default     = "pluckit-prod-api-func"
}

variable "langfuse_public_key" {
  description = "Langfuse public key for tracing and observability."
  type        = string
  sensitive   = true
  default     = ""
}

variable "langfuse_secret_key" {
  description = "Langfuse secret key for tracing and observability."
  type        = string
  sensitive   = true
  default     = ""
}

variable "langfuse_host" {
  description = "Langfuse host for API ingestion."
  type        = string
  default     = "https://us.cloud.langfuse.com"
}
