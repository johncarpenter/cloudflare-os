# Turns the release's binding templates into the finished, API-shaped bindings each worker is
# uploaded with. The release's placeholder set is closed; locals.tf audits that nothing else is left.

locals {
  rendered_bindings = {
    for pkg in local.all_pkgs : pkg => concat(
      # $KV_<BINDING>_ID
      [
        for binding in local.workers_m[pkg].bindings : {
          type         = "kv_namespace"
          name         = binding.name
          namespace_id = cloudflare_workers_kv_namespace.kv["${pkg}:${binding.name}"].id
        } if binding.type == "kv_namespace"
      ],
      # $R2_<BINDING>_NAME
      [
        for binding in local.workers_m[pkg].bindings : {
          type        = "r2_bucket"
          name        = binding.name
          bucket_name = cloudflare_r2_bucket.r2["${pkg}:${binding.name}"].name
        } if binding.type == "r2_bucket"
      ],
      # $WORKER_NAME(<package>)
      [
        for binding in local.workers_m[pkg].bindings : merge(
          {
            type    = "service"
            name    = binding.name
            service = lookup(local.worker_name, try(regex("^\\$WORKER_NAME\\((.+)\\)$", binding.service)[0], ""), "")
          },
          try(binding.entrypoint, null) == null ? {} : { entrypoint = binding.entrypoint },
        ) if binding.type == "service"
      ],
      # $SECRET(<name>), supplied by the operator
      [
        for binding in local.workers_m[pkg].bindings : {
          type = "secret_text"
          name = binding.name
          text = try(var.gatekeeper_secrets[local.gatekeeper_pkgs[pkg]][regex("^\\$SECRET\\((.+)\\)$", binding.text)[0]], null)
        } if binding.type == "secret_text"
      ],
      # Everything with nothing to resolve: ai, browser, worker_loader, assets.
      [
        for binding in local.workers_m[pkg].bindings : binding
        if !contains(["kv_namespace", "r2_bucket", "service", "secret_text"], binding.type)
      ],
      [for name, value in local.plain_vars[pkg] : { type = "plain_text", name = name, text = value }],
      [for binding in local.gatekeeper_bindings_backend : binding if pkg == local.backend_pkg],
      [for binding in local.gatekeeper_bindings_router : binding if pkg == local.router_pkg],
      [for binding in var.backend_extra_bindings : binding if pkg == local.backend_pkg],
      # The Clerk webhook secret is the backend's only secret of its own.
      [
        for secret in nonsensitive(var.clerk_webhook_secret != null) ? [var.clerk_webhook_secret] : [] :
        { type = "secret_text", name = "CLERK_WEBHOOK_SECRET", text = secret } if pkg == local.backend_pkg
      ],
    )
  }

  # What the uploader is handed for each uploaded worker (contracts/worker-spec.md).
  worker_specs = {
    for pkg in local.uploaded_pkgs : pkg => {
      accountId  = var.account_id
      scriptName = local.worker_name[pkg]
      mainModule = local.workers_m[pkg].mainModule
      modules = [
        for module in local.workers_m[pkg].modules : {
          name   = module.name
          type   = module.type
          path   = "${local.release_dir}/modules/${module.sha256}"
          sha256 = module.sha256
        }
      ]
      compatibilityDate  = try(local.workers_m[pkg].compatibilityDate, null)
      compatibilityFlags = local.workers_m[pkg].compatibilityFlags
      bindings           = local.rendered_bindings[pkg]
      migrations         = local.workers_m[pkg].migrations
      observability      = local.observability[pkg]
    }
  }
}
