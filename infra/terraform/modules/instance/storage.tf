# One KV namespace or R2 bucket per binding the deployed workers declare, named from the instance.
#
# Names are ignored after creation: they are what makes a store *this* store, so no later edit of
# an input may replace one, and replacing a store deletes the data in it.

resource "cloudflare_workers_kv_namespace" "kv" {
  for_each = local.kv_titles

  account_id = var.account_id
  title      = each.value

  lifecycle {
    ignore_changes = [title]
  }

  depends_on = [terraform_data.preflight]
}

resource "cloudflare_r2_bucket" "r2" {
  for_each = local.bucket_names

  account_id = var.account_id
  name       = each.value

  lifecycle {
    ignore_changes = [name]
  }

  depends_on = [terraform_data.preflight]
}
