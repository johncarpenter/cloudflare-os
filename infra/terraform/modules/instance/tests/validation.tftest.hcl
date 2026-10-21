# Bad input fails the plan before any resource changes, naming the problem.

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

run "refuses_a_malformed_account_id" {
  command = plan
  variables { account_id = "not-an-account" }
  expect_failures = [var.account_id]
}

run "refuses_an_instance_name_that_cannot_name_workers" {
  command = plan
  variables { instance_name = "Acme_Corp" }
  expect_failures = [var.instance_name]
}

run "refuses_a_name_too_long_for_the_longest_worker_name" {
  command = plan
  variables { instance_name = "an-instance-name-that-is-far-too-long" }
  expect_failures = [var.instance_name]
}

run "refuses_both_public_addresses" {
  command = plan
  variables {
    public_access = {
      custom_domain = { hostname = "os.example.com", zone_name = "example.com" }
      workers_dev   = { public_base_url = "https://acme-router.me.workers.dev" }
    }
  }
  expect_failures = [var.public_access]
}

run "refuses_no_public_address" {
  command = plan
  variables { public_access = {} }
  expect_failures = [var.public_access]
}

run "refuses_a_hostname_outside_its_zone" {
  command = plan
  variables {
    public_access = { custom_domain = { hostname = "os.other.org", zone_name = "example.com" } }
  }
  expect_failures = [var.public_access]
}

run "refuses_a_workers_dev_origin_with_a_path" {
  command = plan
  variables {
    public_access = { workers_dev = { public_base_url = "https://acme-router.me.workers.dev/" } }
  }
  expect_failures = [var.public_access]
}

run "refuses_a_workers_dev_origin_that_names_another_worker" {
  command = plan
  variables {
    public_access = { workers_dev = { public_base_url = "https://acme-workshop-backend.me.workers.dev" } }
  }
  expect_failures = [terraform_data.preflight]
}

run "refuses_a_deployment_with_no_operators" {
  command = plan
  variables { operators = [] }
  expect_failures = [var.operators]
}

run "refuses_a_dedicated_instance_without_its_organization" {
  command = plan
  variables { tenant = { mode = "single" } }
  expect_failures = [var.tenant]
}

run "refuses_a_clerk_issuer_that_is_not_an_origin" {
  command = plan
  variables {
    clerk = { issuer = "https://acme.clerk.accounts.dev/path", publishable_key = "pk_test_abc" }
  }
  expect_failures = [var.clerk]
}

run "refuses_a_release_without_the_clerk_frontend_variant" {
  command = plan
  variables { frontend_variant = "no-such-variant" }
  expect_failures = [terraform_data.preflight]
}

run "refuses_a_release_that_is_not_there" {
  command = plan
  variables { release_dir = "./tests/fixtures/no-such-release" }
  expect_failures = [terraform_data.preflight]
}

run "refuses_a_release_whose_files_do_not_match_their_checksums" {
  command = plan
  variables { release_dir = "./tests/fixtures/release-tampered" }
  expect_failures = [terraform_data.preflight]
}
