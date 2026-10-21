# Deploys the instance's workers in dependency order:
#
#   storage -> gatekeepers -> backend -> router -> public address
#
# The backend and every gatekeeper are uploaded by scripts/terraform/deploy-worker.ts, because the
# provider's cloudflare_workers_script has no `worker_loader` binding (the Gadget sandbox), no
# service-binding `props` (the sharing domain), and does not compute Durable Object migration
# deltas. The router needs none of those and serves static assets, so it is the provider's resource.
#
# Re-running an upload never deletes a worker, and deleting one is its own stable resource:
#
# - `*_upload` resources have no destroy step and re-run when `triggers_replace` changes, which is a
#   hash of everything uploaded. An unchanged instance therefore re-plans to no change.
# - `*_delete` resources have no create step. Their destroy step deletes the Worker, which also
#   deletes the Durable Object data it holds, so it refuses unless TF_CONFIRM_DELETE_WORKERS names it.
#
# A worker removed from the instance is deleted only after the workers that bound it have been
# re-uploaded without that binding (`depends_on` below), so no binding dangles.
#
# Secrets are passed to the uploader through the environment, never arguments or files. They are in
# Terraform state only as part of the hashes, but they are in the state of the router resource and in
# the provider's view of its inputs, so the state must be encrypted (see the runbook).

resource "terraform_data" "gatekeeper_upload" {
  for_each = toset(keys(local.gatekeeper_pkgs))

  triggers_replace = sha256(jsonencode(local.worker_specs[each.key]))

  provisioner "local-exec" {
    command = "${local.deploy_script} deploy"
    environment = {
      WORKER_SPEC = jsonencode(local.worker_specs[each.key])
    }
  }

  depends_on = [terraform_data.preflight, terraform_data.destroy_lock]
}

resource "terraform_data" "gatekeeper_delete" {
  for_each = toset(keys(local.gatekeeper_pkgs))

  input = {
    script = local.deploy_script
    spec   = jsonencode({ accountId = var.account_id, scriptName = local.worker_name[each.key] })
  }

  provisioner "local-exec" {
    when    = destroy
    command = "${self.input.script} delete"
    environment = {
      WORKER_SPEC = self.input.spec
    }
  }

  depends_on = [terraform_data.gatekeeper_upload]
}

resource "terraform_data" "backend_upload" {
  count = local.backend_pkg == null ? 0 : 1

  triggers_replace = sha256(jsonencode(local.worker_specs[local.backend_pkg]))

  provisioner "local-exec" {
    command = "${local.deploy_script} deploy"
    environment = {
      WORKER_SPEC = jsonencode(local.worker_specs[local.backend_pkg])
    }
  }

  depends_on = [
    terraform_data.preflight,
    terraform_data.destroy_lock,
    terraform_data.gatekeeper_upload,
    terraform_data.gatekeeper_delete,
  ]
}

resource "terraform_data" "backend_delete" {
  count = local.backend_pkg == null ? 0 : 1

  input = {
    script = local.deploy_script
    spec   = jsonencode({ accountId = var.account_id, scriptName = local.worker_name[local.backend_pkg] })
  }

  provisioner "local-exec" {
    when    = destroy
    command = "${self.input.script} delete"
    environment = {
      WORKER_SPEC = self.input.spec
    }
  }

  depends_on = [terraform_data.backend_upload]
}

locals {
  router_name    = try(local.worker_name[local.router_pkg], "")
  router_worker  = local.router_pkg == null ? null : local.workers_m[local.router_pkg]
  router_modules = local.router_pkg == null ? [] : local.router_worker.modules
  router_main    = try([for module in local.router_modules : module if module.name == local.router_worker.mainModule], [])
  module_content_types = {
    esm  = "application/javascript+module"
    text = "text/plain"
    wasm = "application/wasm"
    data = "application/octet-stream"
  }
  router_obs = try(local.observability[local.router_pkg], {})
}

resource "cloudflare_workers_script" "router" {
  count = local.router_pkg == null ? 0 : 1

  account_id          = var.account_id
  script_name         = local.worker_name[local.router_pkg]
  main_module         = local.router_worker.mainModule
  content_file        = "${local.release_dir}/modules/${local.router_main[0].sha256}"
  content_sha256      = local.router_main[0].sha256
  compatibility_date  = try(local.router_worker.compatibilityDate, null)
  compatibility_flags = local.router_worker.compatibilityFlags

  files = {
    for module in local.router_modules : module.name => {
      content_file = "${local.release_dir}/modules/${module.sha256}"
      content_type = local.module_content_types[module.type]
    } if module.name != local.router_worker.mainModule
  }

  bindings = local.rendered_bindings[local.router_pkg]

  assets = {
    directory = local.asset_tree
    config = {
      not_found_handling = try(local.router_worker.assetsConfig.not_found_handling, null)
      run_worker_first   = try(local.router_worker.assetsConfig.run_worker_first, null)
    }
  }

  # Every attribute is sent, including the ones Cloudflare would default: it reports its defaults back,
  # and an attribute left null then shows as a change on every plan.
  observability = {
    enabled            = try(local.router_obs.enabled, true)
    head_sampling_rate = try(local.router_obs.head_sampling_rate, 1)
    logs = {
      enabled            = try(local.router_obs.logs.enabled, true)
      invocation_logs    = try(local.router_obs.logs.invocation_logs, false)
      head_sampling_rate = try(local.router_obs.logs.head_sampling_rate, try(local.router_obs.head_sampling_rate, 1))
    }
    traces = {
      enabled            = try(local.router_obs.traces.enabled, false)
      head_sampling_rate = try(local.router_obs.traces.head_sampling_rate, 1)
      persist            = true
    }
  }

  depends_on = [
    terraform_data.preflight,
    terraform_data.destroy_lock,
    terraform_data.backend_upload,
    terraform_data.backend_delete,
    terraform_data.gatekeeper_upload,
    terraform_data.gatekeeper_delete,
  ]
}
