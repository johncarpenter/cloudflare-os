# Run only by scripts/terraform/module-smoke.test.ts, which starts a local stand-in for the Cloudflare
# API and sets CLOUDFLARE_API_TOKEN, CLOUDFLARE_API_BASE_URL and TF_CONFIRM_DELETE_WORKERS. It is the
# one run that executes the real worker uploader from Terraform, and it only works with that server up,
# so it lives outside the default test directory.

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

run "deploys_through_the_uploader" {
  command = apply
}
