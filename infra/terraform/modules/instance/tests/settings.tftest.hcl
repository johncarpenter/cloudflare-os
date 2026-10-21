# Settings an operator can change reach the workers that use them, and only those.

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

run "a_dedicated_instance_pins_its_organization" {
  command = plan

  variables {
    instance_name = "bank"
    tenant        = { mode = "single", id = "org_bank" }
  }

  assert {
    condition     = output.backend_settings.TENANT_MODE == "single" && output.backend_settings.TENANT_ID == "org_bank"
    error_message = "A dedicated instance pins the tenant through the backend's tenant settings."
  }
}

run "an_observability_override_reaches_every_worker" {
  command = plan

  variables {
    observability = {
      head_sampling_rate = 0.25
      invocation_logs    = true
      traces_enabled     = true
    }
  }

  assert {
    condition = alltrue([
      for pkg, observability in output.worker_observability :
      observability.head_sampling_rate == 0.25 && observability.logs.invocation_logs == true && observability.traces.enabled == true
    ])
    error_message = "Every worker takes the operator's logging and tracing settings."
  }

  assert {
    condition     = cloudflare_workers_script.router[0].observability.head_sampling_rate == 0.25
    error_message = "The router, which is the provider's own resource, takes them too."
  }
}

run "without_an_override_the_release_settings_stand" {
  command = plan

  assert {
    condition     = output.worker_observability["workshop-backend"].traces.head_sampling_rate == 0.5
    error_message = "The release's own observability settings are kept."
  }
}

run "the_ai_gateway_is_configured_for_the_backend" {
  command = plan

  variables {
    ai_gateway = { enabled = true, name = "acme-ai", providers = ["cloudflare", "anthropic"], create = true }
  }

  assert {
    condition     = output.backend_settings.CF_AI_GATEWAY == "acme-ai" && output.backend_settings.CF_AI_GATEWAY_PROVIDERS == "cloudflare,anthropic"
    error_message = "The backend is told which gateway and providers to use."
  }

  assert {
    condition     = length(cloudflare_ai_gateway.this) == 1
    error_message = "create provisions the gateway."
  }
}

run "the_default_client_reaches_the_backend" {
  command = plan

  variables {
    ai_gateway = { enabled = true, default_client = "legacy-accounts" }
  }

  assert {
    condition     = output.backend_settings.CF_AI_GATEWAY_DEFAULT_CLIENT == "legacy-accounts"
    error_message = "The fallback client for users of no tenant is passed to the backend."
  }
}

run "without_a_default_client_the_backend_keeps_its_own" {
  command = plan

  variables {
    ai_gateway = { enabled = true }
  }

  assert {
    condition     = !contains(keys(output.backend_settings), "CF_AI_GATEWAY_DEFAULT_CLIENT")
    error_message = "Nothing is set when no default client is given."
  }
}

run "refuses_a_default_client_the_gateway_would_mangle" {
  command = plan

  variables {
    ai_gateway = { enabled = true, default_client = "has spaces" }
  }

  expect_failures = [var.ai_gateway]
}

run "extra_backend_settings_and_bindings_pass_through" {
  command = plan

  variables {
    backend_extra_vars     = { CUSTOM_FLAG = "on" }
    backend_extra_bindings = [{ type = "service", name = "FRONTEND_ERROR_REPORTER", service = "reporter" }]
  }

  assert {
    condition     = output.backend_settings.CUSTOM_FLAG == "on" && contains(output.worker_bindings["workshop-backend"], "service:FRONTEND_ERROR_REPORTER")
    error_message = "Extra settings and raw bindings reach the backend."
  }
}

run "clerk_authorized_parties_can_be_listed_explicitly" {
  command = plan

  variables {
    clerk = {
      issuer             = "https://acme.clerk.accounts.dev"
      publishable_key    = "pk_test_abc"
      authorized_parties = ["https://os.example.com", "https://staging.example.com"]
    }
  }

  assert {
    condition     = output.backend_settings.CLERK_AUTHORIZED_PARTIES == "https://os.example.com,https://staging.example.com"
    error_message = "Explicit authorized parties replace the default."
  }
}

run "no_webhook_secret_means_no_secret_binding" {
  command = plan

  variables {
    clerk_webhook_secret = null
  }

  # The plan warns that the webhook stays disabled.
  expect_failures = [check.clerk_webhook]

  assert {
    condition     = !contains(output.worker_bindings["workshop-backend"], "secret_text:CLERK_WEBHOOK_SECRET")
    error_message = "Without a webhook secret the backend gets none (the plan warns)."
  }
}
