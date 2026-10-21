variable "account_id" {
  type = string
}

variable "instance_name" {
  type    = string
  default = "silo"
}

variable "release_dir" {
  description = "A built release, verified with scripts/terraform/verify-release.ts --materialize."
  type        = string
}

variable "hostname" {
  type = string
}

variable "zone_name" {
  type = string
}

variable "clerk_issuer" {
  type = string
}

variable "clerk_publishable_key" {
  type = string
}

variable "clerk_webhook_secret" {
  type      = string
  default   = null
  sensitive = true
}

variable "operators" {
  type = list(string)
}

variable "gatekeepers" {
  type    = map(object({ vars = optional(map(string), {}) }))
  default = {}
}

variable "gatekeeper_secrets" {
  type      = map(map(string))
  default   = {}
  sensitive = true
}

variable "observability" {
  type = object({
    enabled                   = optional(bool, true)
    head_sampling_rate        = optional(number, 1)
    invocation_logs           = optional(bool, false)
    traces_enabled            = optional(bool, false)
    traces_head_sampling_rate = optional(number, 0.1)
  })
  default = null
}

variable "tenant_organization_id" {
  description = "The Clerk organization (org_...) this instance is dedicated to."
  type        = string
}

variable "ai_gateway" {
  description = "AI Gateway for the backend. Every request is tagged with its client (the user's tenant); default_client tags users of no tenant."
  type = object({
    enabled        = optional(bool, false)
    name           = optional(string, "default")
    providers      = optional(list(string), ["cloudflare"])
    create         = optional(bool, false)
    default_client = optional(string)
  })
  default = {}
}
