# Optional AI Gateway. The backend reaches it over its Workers AI binding, which needs no API token
# inside the same account. `create` provisions it; otherwise ai_gateway.name must already exist
# (every account has "default").

resource "cloudflare_ai_gateway" "this" {
  count = var.ai_gateway.enabled && var.ai_gateway.create ? 1 : 0

  account_id                 = var.account_id
  id                         = var.ai_gateway.name
  cache_invalidate_on_update = false
  cache_ttl                  = 0
  collect_logs               = true
  rate_limiting_interval     = 0
  rate_limiting_limit        = 0
}
