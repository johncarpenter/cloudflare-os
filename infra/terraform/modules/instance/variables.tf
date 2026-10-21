variable "account_id" {
  description = "Cloudflare account that owns every resource of the instance."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_id must be a 32-character lowercase hexadecimal Cloudflare account id."
  }
}

variable "instance_name" {
  description = "Names the instance. Every Worker, KV namespace and R2 bucket name derives from it, so two instances with different names never collide."
  type        = string

  validation {
    # 30 keeps the longest derived Worker name (<name>-gatekeeper-homeassistant) within 63 characters.
    condition     = can(regex("^[a-z][a-z0-9-]{1,28}[a-z0-9]$", var.instance_name))
    error_message = "instance_name must be 3-30 characters: lowercase letters, digits and hyphens, starting with a letter and ending with a letter or digit."
  }
}

variable "release_dir" {
  description = "Directory of a built, published release (the output of scripts/release/build-release.ts), already checked with scripts/terraform/verify-release.ts --materialize."
  type        = string
}

variable "frontend_variant" {
  description = "Which frontend build of the release the router serves. \"standard\" is the build that signs in through Clerk."
  type        = string
  default     = "standard"
}

variable "public_access" {
  description = "Where the instance is reached: exactly one of a custom domain in a zone of the account, or a workers.dev address (evaluation)."
  type = object({
    custom_domain = optional(object({
      hostname  = string
      zone_name = string
    }))
    workers_dev = optional(object({
      public_base_url = string
    }))
  })

  validation {
    condition     = (var.public_access.custom_domain != null) != (var.public_access.workers_dev != null)
    error_message = "public_access must set exactly one of custom_domain or workers_dev."
  }

  validation {
    condition = var.public_access.custom_domain == null ? true : (
      can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.public_access.custom_domain.hostname)) &&
      (var.public_access.custom_domain.hostname == var.public_access.custom_domain.zone_name ||
      endswith(var.public_access.custom_domain.hostname, ".${var.public_access.custom_domain.zone_name}"))
    )
    error_message = "public_access.custom_domain.hostname must be a lowercase hostname inside public_access.custom_domain.zone_name."
  }

  validation {
    condition = var.public_access.workers_dev == null ? true : can(regex(
      "^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?\\.workers\\.dev$",
      var.public_access.workers_dev.public_base_url,
    ))
    error_message = "public_access.workers_dev.public_base_url must be a bare https://<router-name>.<subdomain>.workers.dev origin: no path, no trailing slash."
  }
}

variable "clerk" {
  description = "Clerk sign-in settings (see docs/clerk-signin.md). authorized_parties defaults to the public origin."
  type = object({
    issuer             = string
    publishable_key    = string
    authorized_parties = optional(list(string))
  })

  validation {
    condition     = can(regex("^https://[^/\\s]+$", var.clerk.issuer))
    error_message = "clerk.issuer must be a bare https origin such as https://example.clerk.accounts.dev."
  }

  validation {
    condition     = can(regex("^pk_(test|live)_", var.clerk.publishable_key))
    error_message = "clerk.publishable_key must be a Clerk publishable key (pk_test_... or pk_live_...)."
  }

  validation {
    condition = alltrue([
      for party in coalesce(var.clerk.authorized_parties, []) : can(regex("^https?://[^/\\s]+$", party))
    ])
    error_message = "clerk.authorized_parties must be bare origins such as https://os.example.com."
  }
}

variable "clerk_webhook_secret" {
  description = "Clerk webhook signing secret (whsec_...). Null leaves the webhook endpoint disabled, so membership removal and account deletion then rely on session renewal alone."
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.clerk_webhook_secret == null ? true : startswith(var.clerk_webhook_secret, "whsec_")
    error_message = "clerk_webhook_secret must be a Svix signing secret starting with whsec_."
  }
}

variable "operators" {
  description = "Clerk user ids of the deployment operators (the backend's ADMINS). An organization role never grants this."
  type        = list(string)

  validation {
    condition     = length(var.operators) > 0 && alltrue([for operator in var.operators : length(trimspace(operator)) > 0])
    error_message = "operators must list at least one Clerk user id."
  }
}

variable "tenant" {
  description = "Tenancy: \"pool\" resolves a tenant per session; \"single\" pins the instance to the Clerk organization id in id."
  type = object({
    mode = optional(string, "pool")
    id   = optional(string)
  })
  default = {}

  validation {
    condition     = contains(["pool", "single"], var.tenant.mode)
    error_message = "tenant.mode must be \"pool\" or \"single\"."
  }

  validation {
    condition     = var.tenant.mode != "single" || (var.tenant.id != null && startswith(coalesce(var.tenant.id, ""), "org_"))
    error_message = "tenant.id must be a Clerk organization id (org_...) when tenant.mode is \"single\"."
  }
}

variable "gatekeepers" {
  description = "Integrations to install beyond the ones every instance gets, keyed by the release's short name (for example github). vars adds plain settings to that gatekeeper."
  type = map(object({
    vars = optional(map(string), {})
  }))
  default = {}
}

variable "gatekeeper_secrets" {
  description = "Credentials for enabled integrations: short name -> { SECRET_NAME = value }. Every secret the release declares for an enabled integration must be present."
  type        = map(map(string))
  default     = {}
  sensitive   = true
}

variable "ai_gateway" {
  description = "AI Gateway the backend routes models through. create provisions the gateway in this account; otherwise name must already exist. Every request is tagged with its client (the user's tenant); default_client is the tag for users that belong to no tenant, so none reaches the gateway unattributed."
  type = object({
    enabled        = optional(bool, false)
    name           = optional(string, "default")
    providers      = optional(list(string), ["cloudflare"])
    create         = optional(bool, false)
    default_client = optional(string)
  })
  default = {}

  validation {
    condition     = var.ai_gateway.default_client == null ? true : can(regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$", var.ai_gateway.default_client))
    error_message = "ai_gateway.default_client must be 1-64 characters: letters, digits, dots, underscores and hyphens, starting with a letter or digit."
  }
}

variable "observability" {
  description = "Workers logs and traces applied to every Worker of the instance. Null keeps what the release declares."
  type = object({
    enabled                   = optional(bool, true)
    head_sampling_rate        = optional(number, 1)
    invocation_logs           = optional(bool, false)
    traces_enabled            = optional(bool, false)
    traces_head_sampling_rate = optional(number, 0.1)
  })
  default = null
}

variable "backend_extra_vars" {
  description = "Extra plain-text settings for the backend, for settings this module does not model."
  type        = map(string)
  default     = {}
}

variable "backend_extra_bindings" {
  description = "Extra raw Workers API bindings for the backend, for example the error reporter service and its rate limiter."
  type        = list(any)
  default     = []
}

variable "uploader_command" {
  description = "How the worker uploader is invoked; \"deploy\" or \"delete\" is appended. Null runs scripts/terraform/deploy-worker.ts with node. Override to run it in a container or sandbox, or to stub it in tests."
  type        = string
  default     = null
}
