# Changes that would hide or destroy data are plan errors, not surprises.
#
# The first run applies with the uploader stubbed (uploader_command = "true"), so nothing is uploaded;
# the later runs then plan against that state.

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

  # The uploader steps are stubbed: nothing is uploaded and nothing is deleted.
  uploader_command = "true"
}

run "applies_the_instance" {
  command = apply

  assert {
    condition     = jsonencode(terraform_data.identity_lock.input) == jsonencode({ account_id = "0123456789abcdef0123456789abcdef", instance_name = "acme", public_base_url = "https://os.example.com", sharing_domain = "https://os.example.com" })
    error_message = "The lock records the instance name, the account, the public origin and the sharing domain."
  }
}

run "refuses_changing_the_public_origin" {
  command = plan

  variables {
    public_access = {
      custom_domain = { hostname = "app.example.com", zone_name = "example.com" }
    }
  }

  expect_failures = [terraform_data.preflight]
}

run "refuses_renaming_the_instance" {
  command = plan

  variables {
    instance_name = "acme2"
  }

  expect_failures = [terraform_data.preflight]
}

run "allows_ordinary_changes" {
  command = plan

  variables {
    operators = ["user_operator", "user_second"]
  }

  assert {
    condition     = contains(jsondecode(output.backend_settings.ADMINS), "user_second")
    error_message = "Changing operators is an ordinary in-place change."
  }
}
