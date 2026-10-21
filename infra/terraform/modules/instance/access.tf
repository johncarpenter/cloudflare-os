# The public address: a custom domain in a zone of the account, or the router's workers.dev address
# for evaluation. Only the router has one.

# Looked up at plan time: a zone that is not in the account (or that the token cannot read) fails the
# plan here rather than at the first upload.
data "cloudflare_zone" "zone" {
  count = var.public_access.custom_domain == null ? 0 : 1

  filter = {
    name    = var.public_access.custom_domain.zone_name
    account = { id = var.account_id }
  }
}

resource "cloudflare_workers_custom_domain" "router" {
  count = var.public_access.custom_domain == null ? 0 : 1

  account_id = var.account_id
  hostname   = var.public_access.custom_domain.hostname
  service    = local.router_name
  zone_id    = data.cloudflare_zone.zone[0].zone_id

  # The domain is attached only once the router it points at exists.
  depends_on = [cloudflare_workers_script.router]
}

resource "cloudflare_workers_script_subdomain" "router" {
  count = var.public_access.workers_dev == null ? 0 : 1

  account_id       = var.account_id
  script_name      = local.router_name
  enabled          = true
  previews_enabled = false

  depends_on = [cloudflare_workers_script.router]
}
