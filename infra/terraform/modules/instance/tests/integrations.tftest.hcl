# Which integrations are installed, and what each needs.

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

run "enables_an_integration_with_its_credentials" {
  command = plan

  variables {
    gatekeepers        = { github = { vars = { GITHUB_NOTE = "enterprise" } } }
    gatekeeper_secrets = { github = { CLIENT_ID = "id", CLIENT_SECRET = "secret" } }
  }

  assert {
    condition     = output.installed_gatekeepers == tolist(["context", "github", "scheduler"])
    error_message = "The enabled integration is installed beside the defaults."
  }

  assert {
    condition = alltrue([
      for binding in ["secret_text:CLIENT_ID", "secret_text:CLIENT_SECRET", "plain_text:BASE_URL", "plain_text:GITHUB_NOTE"] :
      contains(output.worker_bindings["gatekeeper-github"], binding)
    ])
    error_message = "The integration gets its credentials, its base URL, and the operator's settings."
  }

  assert {
    condition     = contains(output.worker_bindings["workshop-backend"], "service:GATEKEEPER_GITHUB") && contains(output.worker_bindings["router"], "service:GATEKEEPER_GITHUB")
    error_message = "The backend and the router both reach the new integration."
  }

  assert {
    condition     = output.worker_names["gatekeeper-github"] == "acme-gatekeeper-github"
    error_message = "The integration's Worker is named from the instance."
  }
}

run "refuses_an_integration_without_its_credentials" {
  command = plan

  variables {
    gatekeepers        = { github = {} }
    gatekeeper_secrets = { github = { CLIENT_ID = "id" } }
  }

  expect_failures = [terraform_data.preflight]
}

run "refuses_an_integration_with_no_credentials_at_all" {
  command = plan

  variables {
    gatekeepers = { github = {} }
  }

  expect_failures = [terraform_data.preflight]
}

run "refuses_an_integration_that_cannot_be_installed" {
  command = plan

  variables {
    gatekeepers = { email = {} }
  }

  expect_failures = [terraform_data.preflight]
}

run "refuses_an_integration_the_release_does_not_have" {
  command = plan

  variables {
    gatekeepers = { nothing = {} }
  }

  expect_failures = [terraform_data.preflight]
}
