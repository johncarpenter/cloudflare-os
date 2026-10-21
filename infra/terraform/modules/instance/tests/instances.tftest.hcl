# Several instances from one model share nothing.

mock_provider "cloudflare" {
  mock_data "cloudflare_zone" {
    defaults = {
      zone_id = "zone-1"
    }
  }
}

variables {
  account_id    = "0123456789abcdef0123456789abcdef"
  release_dir   = "./tests/fixtures/release"
  instance_name = "pool"

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

run "the_pool" {
  command = plan

  assert {
    condition     = output.worker_names["router"] == "pool-router" && output.r2_bucket_names["workshop-backend:BLUEPRINT_CONTENT"] == "pool-blueprint-content"
    error_message = "The pool's names derive from its instance name."
  }
}

run "a_silo_in_the_same_account" {
  command = plan

  variables {
    instance_name = "bank"
    tenant        = { mode = "single", id = "org_bank" }
    public_access = {
      custom_domain = { hostname = "bank.example.com", zone_name = "example.com" }
    }
  }

  assert {
    condition     = output.worker_names["router"] == "bank-router" && output.r2_bucket_names["workshop-backend:BLUEPRINT_CONTENT"] == "bank-blueprint-content"
    error_message = "The silo shares no Worker or bucket name with the pool."
  }

  assert {
    condition     = output.public_base_url == "https://bank.example.com"
    error_message = "The silo has its own address."
  }
}
