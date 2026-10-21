# Quickstart: validating the Terraform deployment

Steps marked **(live)** need a Cloudflare account and Clerk application; the rest run anywhere.

## Offline checks

```sh
# Node tooling
node --test scripts/terraform/*.test.ts scripts/release/*.test.ts
pnpm run types:scripts

# Terraform module
cd infra/terraform/modules/instance
terraform init -backend=false
terraform validate
terraform test
terraform fmt -check -recursive ../..
```

## First launch (live)

1. Build a release with a Clerk-capable frontend: `node scripts/release/build-release.ts --out release-out`.
2. Verify and prepare it: `node scripts/terraform/verify-release.ts release-out --variant standard --materialize`.
3. `cd infra/terraform/examples/pool && cp terraform.tfvars.example terraform.tfvars`, fill it in, set
   `CLOUDFLARE_API_TOKEN`, and configure an encrypted remote backend (see the runbook).
4. `terraform init && terraform plan` - confirm only creations, then `terraform apply`.
5. Take `clerk_webhook_url` and `clerk_authorized_parties` from the outputs into the Clerk dashboard.
6. Open the public address, sign in, create a workspace, ask an agent to use the context library.

## Re-apply and upgrade (live)

- Unchanged: `terraform plan` reports no changes.
- Change an operator or observability value: only the backend upload changes; data intact.
- New release: set `release_dir`, plan, apply; roll back by pointing back and applying.

## Guard rails (offline via `terraform test`; live to confirm)

- Changing `instance_name`, `account_id` or the public origin fails the plan naming
  `terraform_data.protection_lock`.
- `terraform destroy` fails the plan until the lock is removed from state.
- Disabling a gatekeeper deletes its Worker only when `TF_CONFIRM_DELETE_WORKERS` names it.
- A tampered module file, missing gatekeeper secret or leftover placeholder fails the plan.
