output "public_base_url" {
  description = "The instance's public origin."
  value       = local.public_base_url
}

output "clerk_webhook_url" {
  description = "Register this endpoint in Clerk (events organizationMembership.deleted, user.deleted and organization.deleted)."
  value       = "${local.public_base_url}/api/clerk-webhook"
}

output "clerk_authorized_parties" {
  description = "Origins the instance accepts Clerk session tokens for; allow them in Clerk."
  value       = local.authorized_parties
}

output "worker_names" {
  description = "Deployed Worker name by release package."
  value       = local.worker_name
}

output "installed_gatekeepers" {
  description = "Short names of the installed integrations."
  value       = sort(keys(local.deployed_gatekeepers))
}

output "kv_namespace_ids" {
  description = "Provisioned KV namespaces by worker:binding."
  value       = { for key, namespace in cloudflare_workers_kv_namespace.kv : key => namespace.id }
}

output "r2_bucket_names" {
  description = "Provisioned R2 buckets by worker:binding."
  value       = { for key, bucket in cloudflare_r2_bucket.r2 : key => bucket.name }
}

output "release_id" {
  description = "The release deployed."
  value       = local.release_id
}

# The outputs below describe what each worker is wired to. They carry names and non-secret settings
# only: no secret binding text ever reaches an output.

output "worker_bindings" {
  description = "type:name of every binding of each deployed worker."
  value = {
    for pkg, bindings in local.rendered_bindings : pkg => sort([for binding in bindings : "${binding.type}:${binding.name}"])
  }
}

output "backend_gatekeeper_bindings" {
  description = "The backend's service bindings to the installed gatekeepers, with their props."
  value       = local.gatekeeper_bindings_backend
}

output "backend_settings" {
  description = "The backend's plain-text settings (no secrets)."
  value       = try(local.plain_vars[local.backend_pkg], {})
}

output "worker_observability" {
  description = "The observability settings each worker is deployed with."
  value       = local.observability
}
