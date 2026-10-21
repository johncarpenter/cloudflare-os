# Refuses, at plan time, anything that would silently lose or hide data.

# What this instance is: its name, account and public origin. The values are recorded when the lock is
# created and never updated (`ignore_changes`), and the preflight check refuses any plan in which the
# inputs no longer match them. That matters because:
#
# - the sharing domain is the public origin, and the context library scopes its data by it, so a
#   changed origin makes existing collections vanish without an error;
# - the instance name and account name every Worker and store, so a changed one would build a second
#   instance beside the first.
#
# To change one on purpose, remove this resource from state (see the runbook) and plan again; it is
# then recorded afresh.
resource "terraform_data" "identity_lock" {
  input = {
    instance_name   = var.instance_name
    account_id      = var.account_id
    public_base_url = local.public_base_url
    sharing_domain  = local.sharing_domain
  }

  lifecycle {
    ignore_changes = [input]
  }
}

# Makes `terraform destroy` a plan error, before anything is deleted, because destroying the instance
# destroys its data. To tear down on purpose, remove this resource from state first (see the runbook),
# and set TF_CONFIRM_DELETE_WORKERS for the Workers.
resource "terraform_data" "destroy_lock" {
  lifecycle {
    prevent_destroy = true
  }
}

# Every check that depends on the release or on several inputs together. Each fails the plan before
# any resource changes, naming what is wrong.
resource "terraform_data" "preflight" {
  lifecycle {
    precondition {
      condition = jsonencode(terraform_data.identity_lock.input) == jsonencode({
        instance_name   = var.instance_name
        account_id      = var.account_id
        public_base_url = local.public_base_url
        sharing_domain  = local.sharing_domain
      })
      error_message = "instance_name, account_id and the public origin identify this instance and cannot be changed in place: a changed public origin hides existing context data, and a changed name or account builds a second instance. Recorded: ${jsonencode(terraform_data.identity_lock.input)}. If you mean to change them, run: terraform state rm 'terraform_data.identity_lock' (see the runbook)."
    }

    precondition {
      condition     = local.manifest != null
      error_message = "release_dir (${var.release_dir}) has no readable manifest.json: the release is incomplete or its build did not finish."
    }

    precondition {
      condition     = length(local.backend_pkgs) == 1 && length(local.router_pkgs) == 1
      error_message = "The release must contain exactly one backend and one router worker."
    }

    precondition {
      condition     = contains(local.router_variants, var.frontend_variant)
      error_message = "The release has no \"${var.frontend_variant}\" frontend variant (it has: ${join(", ", local.router_variants)}). Rebuild it with the current scripts/release/build-release.ts."
    }

    precondition {
      condition     = length(try(fileset(local.asset_tree, "**"), [])) > 0
      error_message = "No asset tree at ${local.asset_tree}. Run: node scripts/terraform/verify-release.ts ${var.release_dir} --variant ${var.frontend_variant} --materialize"
    }

    precondition {
      condition     = length(local.unknown_gatekeepers) == 0
      error_message = "Not installable gatekeepers in this release: ${join(", ", local.unknown_gatekeepers)}. Installable: ${join(", ", local.installable)}."
    }

    precondition {
      condition     = length(local.missing_secrets) == 0
      error_message = "Missing gatekeeper_secrets: ${join("; ", local.missing_secrets)}."
    }

    precondition {
      condition     = length(local.module_problems) == 0
      error_message = "Release files are missing or do not match the manifest checksums: ${join("; ", local.module_problems)}."
    }

    precondition {
      condition     = length(local.unresolved_bindings) == 0 && length(local.unresolved_vars) == 0
      error_message = "The release uses a placeholder this module does not resolve: ${join("; ", concat(local.unresolved_bindings, local.unresolved_vars))}."
    }

    precondition {
      condition     = length(local.unknown_service_targets) == 0
      error_message = "A service binding names a worker this instance does not deploy: ${join("; ", local.unknown_service_targets)}."
    }

    precondition {
      condition     = length(local.bucket_name_problems) == 0
      error_message = "R2 bucket names must be 3-63 characters: ${join(", ", local.bucket_name_problems)}."
    }

    precondition {
      condition     = local.names_unique
      error_message = "Two stores of this instance would get the same name."
    }

    precondition {
      condition = var.public_access.workers_dev == null ? true : (
        local.router_pkg != null && startswith(trimprefix(var.public_access.workers_dev.public_base_url, "https://"), "${var.instance_name}-${local.router_pkg}.")
      )
      error_message = "public_access.workers_dev.public_base_url must be https://${var.instance_name}-${coalesce(local.router_pkg, "router")}.<subdomain>.workers.dev: the router, not another Worker, answers on the public origin."
    }
  }
}

check "clerk_webhook" {
  assert {
    condition     = var.clerk_webhook_secret != null
    error_message = "clerk_webhook_secret is not set: the Clerk webhook endpoint stays disabled, so membership removal and account deletion take effect only through session renewal."
  }
}
