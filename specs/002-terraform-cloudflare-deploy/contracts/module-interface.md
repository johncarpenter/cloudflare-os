# Contract: `infra/terraform/modules/instance`

```hcl
module "instance" {
  source = "../../modules/instance"

  account_id    = "0123456789abcdef0123456789abcdef"
  instance_name = "acme"
  release_dir   = "/path/to/release-out"

  public_access = { custom_domain = { hostname = "os.example.com", zone_name = "example.com" } }

  clerk = {
    issuer          = "https://example.clerk.accounts.dev"
    publishable_key = "pk_live_..."
  }
  clerk_webhook_secret = var.clerk_webhook_secret   # sensitive
  operators            = ["user_2abc..."]
  tenant               = { mode = "pool" }

  gatekeepers        = { github = {} }
  gatekeeper_secrets = { github = { CLIENT_ID = var.gh_id, CLIENT_SECRET = var.gh_secret } }
}
```

## Inputs

See [data-model.md](../data-model.md). Defaults: `frontend_variant = "standard"`,
`tenant = { mode = "pool" }`, `gatekeepers = {}`, `ai_gateway = { enabled = false }`,
`observability = { enabled = true, head_sampling_rate = 1, invocation_logs = false,
traces_enabled = false, traces_head_sampling_rate = 0.1 }`.

## Validations (fail at plan, before any change)

| Condition | Message names |
|---|---|
| `account_id` not 32 hex | `account_id` |
| `instance_name` malformed | `instance_name` |
| both or neither of `custom_domain`/`workers_dev` | `public_access` |
| `workers_dev.public_base_url` not a bare https origin | `public_access.workers_dev.public_base_url` |
| `custom_domain.hostname` not in `zone_name` | `public_access.custom_domain` |
| `custom_domain.zone_name` not found in the account | `zone_name` |
| `clerk.issuer`/`authorized_parties` not https origins | `clerk` |
| no operators | `operators` |
| `tenant.mode = "single"` without `tenant.id` | `tenant.id` |
| gatekeeper key not an installable gatekeeper in the release | the key |
| enabled gatekeeper missing a manifest-declared secret | gatekeeper and secret name |
| release incomplete or `frontend_variant` absent | `release_dir`, `frontend_variant` |
| a module file's SHA-256 differs from the manifest | worker and file |
| a `$` placeholder left after rendering | worker and binding |
| a derived name too long or colliding | the name |

## Outputs

| Output | Meaning |
|---|---|
| `public_base_url` | The instance's public origin. |
| `clerk_webhook_url` | `<origin>/api/clerk-webhook`, to register in Clerk. |
| `clerk_authorized_parties` | Origins to allow in Clerk. |
| `worker_names` | Map package -> deployed Worker name. |
| `installed_gatekeepers` | Sorted short names. |
| `kv_namespace_ids`, `r2_bucket_names` | Provisioned stores. |
| `release_id` | The release deployed. |

No output carries a secret.

## Provider and tooling requirements

`terraform >= 1.9`, `cloudflare/cloudflare ~> 5.28`, `hashicorp/null`-free (only built-in
`terraform_data`), Node >= 24.19 on the machine that runs apply, and `CLOUDFLARE_API_TOKEN` in the
environment (the same token feeds the provider and the uploader). Token permissions: Workers
Scripts Write, Workers KV Storage Write, Workers R2 Storage Write, Account Settings Read, Zone Read,
Workers Routes/Custom Domains Write (zone), and AI Gateway Write when `ai_gateway.create`.
