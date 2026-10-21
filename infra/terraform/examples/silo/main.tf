# A dedicated (silo) instance: pinned to one Clerk organization; anyone else is refused.
# Copy terraform.tfvars.example to terraform.tfvars and fill it in. Authenticate with
# CLOUDFLARE_API_TOKEN in the environment (the provider and the worker uploader both read it).

terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }

  # Use an encrypted remote backend with locking: state holds secrets. See backend.tf.example.
}

provider "cloudflare" {}

module "instance" {
  # Relative to this directory. If you copy this root elsewhere (the runbook copies it to
  # infra/terraform/live-<name>), change it to point at infra/terraform/modules/instance.
  source = "../../modules/instance"

  account_id    = var.account_id
  instance_name = var.instance_name
  release_dir   = var.release_dir

  public_access = {
    custom_domain = { hostname = var.hostname, zone_name = var.zone_name }
  }

  clerk = {
    issuer          = var.clerk_issuer
    publishable_key = var.clerk_publishable_key
  }
  clerk_webhook_secret = var.clerk_webhook_secret
  operators            = var.operators
  tenant               = { mode = "single", id = var.tenant_organization_id }

  gatekeepers        = var.gatekeepers
  gatekeeper_secrets = var.gatekeeper_secrets
  observability      = var.observability
  ai_gateway         = var.ai_gateway
}

output "public_base_url" {
  value = module.instance.public_base_url
}

output "clerk_webhook_url" {
  value = module.instance.clerk_webhook_url
}

output "clerk_authorized_parties" {
  value = module.instance.clerk_authorized_parties
}

output "installed_gatekeepers" {
  value = module.instance.installed_gatekeepers
}

output "release_id" {
  value = module.instance.release_id
}
