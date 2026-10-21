# First launch: every component, connection and output is planned from a release, with defaults.
# Plan-only runs: no provisioner executes, and the provider is mocked.

mock_provider "cloudflare" {
  mock_data "cloudflare_zone" {
    defaults = {
      zone_id = "zone-1"
    }
  }
}

variables {
  account_id    = "0123456789abcdef0123456789abcdef"
  instance_name = "acme"
  release_dir   = "./tests/fixtures/release"

  public_access = {
    custom_domain = { hostname = "os.example.com", zone_name = "example.com" }
  }

  clerk = {
    issuer          = "https://acme.clerk.accounts.dev"
    publishable_key = "pk_test_abc"
  }
  clerk_webhook_secret = "whsec_dGVzdA=="
  operators            = ["user_operator"]
}

run "launches_a_complete_instance" {
  command = plan

  assert {
    condition     = output.public_base_url == "https://os.example.com"
    error_message = "The public origin is the custom domain."
  }

  assert {
    condition     = output.clerk_webhook_url == "https://os.example.com/api/clerk-webhook"
    error_message = "The webhook URL is derived from the public origin."
  }

  assert {
    condition     = output.clerk_authorized_parties == tolist(["https://os.example.com"])
    error_message = "Authorized parties default to the public origin."
  }

  assert {
    condition = jsonencode(output.worker_names) == jsonencode({
      "gatekeeper-context"   = "acme-gatekeeper-context"
      "gatekeeper-scheduler" = "acme-gatekeeper-scheduler"
      "router"               = "acme-router"
      "workshop-backend"     = "acme-workshop-backend"
    })
    error_message = "By default exactly the router, the backend, and the preinstalled gatekeepers are deployed, named from the instance."
  }

  assert {
    condition     = output.installed_gatekeepers == tolist(["context", "scheduler"])
    error_message = "Only the preinstalled integrations are installed by default."
  }

  assert {
    condition     = output.release_id == "fixture-1"
    error_message = "The release id comes from the manifest."
  }

  assert {
    condition     = length(cloudflare_workers_custom_domain.router) == 1 && length(cloudflare_workers_script_subdomain.router) == 0
    error_message = "A custom domain is attached; workers.dev is not."
  }
}

run "wires_the_backend_for_the_sandbox_and_the_gatekeepers" {
  command = plan

  assert {
    condition = alltrue([
      for binding in ["worker_loader:LOADER", "browser:BROWSER", "ai:WORKERS_AI", "kv_namespace:BLUEPRINTS", "kv_namespace:AVATARS", "r2_bucket:BLUEPRINT_CONTENT", "service:GATEKEEPER_CONTEXT", "service:GATEKEEPER_SCHEDULER", "secret_text:CLERK_WEBHOOK_SECRET", "plain_text:ADMINS", "plain_text:CLERK_ISSUER"] :
      contains(output.worker_bindings["workshop-backend"], binding)
    ])
    error_message = "The backend has the sandbox loader, its stores, one service binding per gatekeeper, and its Clerk settings."
  }

  assert {
    condition     = output.backend_gatekeeper_bindings[0].entrypoint == "GatekeeperVendor"
    error_message = "The backend calls gatekeepers through the GatekeeperVendor entrypoint."
  }

  assert {
    condition = anytrue([
      for binding in output.backend_gatekeeper_bindings : try(binding.props.sharingDomain, "") == "https://os.example.com"
    ])
    error_message = "The context gatekeeper gets the public origin as its sharing domain."
  }

  assert {
    condition     = output.backend_settings.ADMINS == "[\"user_operator\"]" && output.backend_settings.PUBLIC_BASE_URL == "https://os.example.com"
    error_message = "Operators and the public origin reach the backend."
  }

  assert {
    condition     = !contains(keys(output.backend_settings), "TENANT_MODE")
    error_message = "The shared pool sets no tenant pin."
  }
}

run "the_router_only_binds_what_it_routes_to" {
  command = plan

  assert {
    condition = alltrue([
      for binding in ["service:WORKSHOP_BACKEND", "service:GATEKEEPER_CONTEXT", "service:GATEKEEPER_SCHEDULER", "assets:ASSETS"] :
      contains(output.worker_bindings["router"], binding)
    ])
    error_message = "The router reaches the backend and each gatekeeper, and serves assets."
  }

  assert {
    condition     = length(cloudflare_workers_script.router[0].files) == 0 && cloudflare_workers_script.router[0].assets.directory == abspath("./tests/fixtures/release/asset-trees/standard")
    error_message = "The router serves the standard frontend variant."
  }
}

run "one_store_per_binding_named_from_the_instance" {
  command = plan

  assert {
    condition     = jsonencode(output.r2_bucket_names) == jsonencode({ "workshop-backend:BLUEPRINT_CONTENT" = "acme-blueprint-content" })
    error_message = "The blueprint bucket is named from the instance."
  }

  assert {
    condition     = length(cloudflare_workers_kv_namespace.kv) == 3
    error_message = "Blueprints, avatars and the context collections each get a namespace."
  }
}

run "evaluation_address_uses_workers_dev" {
  command = plan

  variables {
    public_access = {
      workers_dev = { public_base_url = "https://acme-router.me.workers.dev" }
    }
  }

  assert {
    condition     = output.public_base_url == "https://acme-router.me.workers.dev"
    error_message = "The evaluation origin is the given workers.dev address."
  }

  assert {
    condition     = length(cloudflare_workers_custom_domain.router) == 0 && length(cloudflare_workers_script_subdomain.router) == 1
    error_message = "workers.dev is enabled and no custom domain is attached."
  }
}
