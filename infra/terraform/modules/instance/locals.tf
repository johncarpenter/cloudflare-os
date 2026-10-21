# Everything derived from the release manifest and the inputs. Nothing here creates a resource;
# render.tf turns it into API-shaped bindings and the worker specs.

locals {
  # --- The release ----------------------------------------------------------------------------

  release_dir   = abspath(var.release_dir)
  manifest_path = "${local.release_dir}/manifest.json"
  # null when the release is missing or unreadable; the preflight check then says so, once.
  manifest   = try(jsondecode(file(local.manifest_path)), null)
  workers_m  = try(local.manifest.workers, {})
  release_id = try(local.manifest.releaseId, null)

  backend_pkgs = [for pkg, worker in local.workers_m : pkg if worker.kind == "backend"]
  router_pkgs  = [for pkg, worker in local.workers_m : pkg if worker.kind == "router"]
  backend_pkg  = try(local.backend_pkgs[0], null)
  router_pkg   = try(local.router_pkgs[0], null)

  # Gatekeepers by the short name the release gives them (it names the GATEKEEPER_<SLUG> binding and
  # the /gatekeeper/<slug> route).
  gatekeepers_m = {
    for pkg, worker in local.workers_m : worker.shortName => merge(worker, { pkg = pkg })
    if worker.kind == "gatekeeper"
  }
  preinstalled = [for short, gatekeeper in local.gatekeepers_m : short if try(gatekeeper.preinstall, false)]
  installable  = [for short, gatekeeper in local.gatekeepers_m : short if gatekeeper.installable]

  # Every instance gets the preinstalled gatekeepers; the operator adds others by name.
  requested_gatekeepers = toset(concat(local.preinstalled, keys(var.gatekeepers)))
  unknown_gatekeepers   = [for short in local.requested_gatekeepers : short if !contains(local.installable, short)]
  deployed_gatekeepers  = { for short in local.requested_gatekeepers : short => local.gatekeepers_m[short] if contains(local.installable, short) }
  gatekeeper_pkgs       = { for short, gatekeeper in local.deployed_gatekeepers : gatekeeper.pkg => short }

  # The workers this instance deploys. The backend and gatekeepers go through the uploader; the router
  # is the provider's own resource (it serves static assets).
  uploaded_pkgs = compact(concat([local.backend_pkg], [for short, gatekeeper in local.deployed_gatekeepers : gatekeeper.pkg]))
  all_pkgs      = compact(concat(local.uploaded_pkgs, [local.router_pkg]))
  worker_name   = { for pkg in local.all_pkgs : pkg => "${var.instance_name}-${pkg}" }

  # --- Public origin --------------------------------------------------------------------------

  public_base_url    = try("https://${var.public_access.custom_domain.hostname}", var.public_access.workers_dev.public_base_url)
  sharing_domain     = local.public_base_url
  authorized_parties = var.clerk.authorized_parties != null ? var.clerk.authorized_parties : [local.public_base_url]

  # --- Frontend -------------------------------------------------------------------------------

  router_variants = try(keys(local.workers_m[local.router_pkg].assetsConfig.variants), [])
  asset_tree      = "${local.release_dir}/asset-trees/${var.frontend_variant}"

  # --- Stores (one per KV/R2 binding the deployed workers declare) -----------------------------

  kv_bindings = {
    for item in flatten([
      for pkg in local.all_pkgs : [
        for binding in local.workers_m[pkg].bindings : { key = "${pkg}:${binding.name}", pkg = pkg, binding = binding.name }
        if binding.type == "kv_namespace"
      ]
    ]) : item.key => item
  }
  r2_bindings = {
    for item in flatten([
      for pkg in local.all_pkgs : [
        for binding in local.workers_m[pkg].bindings : { key = "${pkg}:${binding.name}", pkg = pkg, binding = binding.name }
        if binding.type == "r2_bucket"
      ]
    ]) : item.key => item
  }
  kv_titles    = { for key, item in local.kv_bindings : key => "${var.instance_name}-${item.pkg}-${lower(replace(item.binding, "_", "-"))}" }
  bucket_names = { for key, item in local.r2_bindings : key => "${var.instance_name}-${lower(replace(item.binding, "_", "-"))}" }

  # --- Observability --------------------------------------------------------------------------

  observability_override = var.observability == null ? null : {
    enabled            = var.observability.enabled
    head_sampling_rate = var.observability.head_sampling_rate
    logs               = { invocation_logs = var.observability.invocation_logs }
    traces = {
      enabled            = var.observability.traces_enabled
      head_sampling_rate = var.observability.traces_head_sampling_rate
    }
  }
  # jsondecode(jsonencode()) so the two branches share one (dynamic) type.
  observability = {
    for pkg in local.all_pkgs : pkg => jsondecode(
      local.observability_override == null ? jsonencode(local.workers_m[pkg].observability) : jsonencode(local.observability_override)
    )
  }

  # --- Settings (plain-text bindings) ---------------------------------------------------------

  ai_vars = var.ai_gateway.enabled ? {
    CF_AI_GATEWAY            = var.ai_gateway.name
    CF_AI_GATEWAY_PROVIDERS  = join(",", var.ai_gateway.providers)
    CF_AI_GATEWAY_ACCOUNT_ID = var.account_id
  } : {}

  # The client usage is attributed to when the user belongs to no tenant. Unset leaves the backend's
  # own default ("default").
  ai_default_client = var.ai_gateway.enabled && var.ai_gateway.default_client != null ? {
    CF_AI_GATEWAY_DEFAULT_CLIENT = var.ai_gateway.default_client
  } : {}

  backend_vars = merge(
    {
      CLERK_ISSUER             = var.clerk.issuer
      CLERK_PUBLISHABLE_KEY    = var.clerk.publishable_key
      CLERK_AUTHORIZED_PARTIES = join(",", local.authorized_parties)
      # A JSON array in a plain-text binding: the backend accepts that form for ADMINS.
      ADMINS = jsonencode(var.operators)
    },
    var.tenant.mode == "single" ? { TENANT_MODE = "single", TENANT_ID = var.tenant.id } : {},
    local.ai_vars,
    local.ai_default_client,
    var.backend_extra_vars,
  )

  # The manifest's own vars with its two instance-level placeholders resolved, plus the operator's.
  manifest_vars = {
    for pkg in local.all_pkgs : pkg => {
      for name, value in local.workers_m[pkg].vars :
      name => replace(replace(tostring(value), "$PUBLIC_BASE_URL", local.public_base_url), "$ACCOUNT_ID", var.account_id)
    }
  }
  plain_vars = {
    for pkg in local.all_pkgs : pkg => merge(
      local.manifest_vars[pkg],
      pkg == local.backend_pkg ? local.backend_vars : {},
      try(var.gatekeepers[local.gatekeeper_pkgs[pkg]].vars, {}),
    )
  }

  # --- Gatekeeper wiring ----------------------------------------------------------------------

  backend_expansion = try(local.workers_m[local.backend_pkg].gatekeeperBindingExpansion, null)
  gatekeeper_bindings_backend = [
    for short, gatekeeper in local.deployed_gatekeepers : merge(
      {
        type    = "service"
        name    = "GATEKEEPER_${upper(short)}"
        service = local.worker_name[gatekeeper.pkg]
      },
      try(local.backend_expansion.entrypoint, null) == null ? {} : { entrypoint = local.backend_expansion.entrypoint },
      length(try(local.backend_expansion.propsByPackage[gatekeeper.pkg], {})) == 0 ? {} : {
        props = {
          for name, value in local.backend_expansion.propsByPackage[gatekeeper.pkg] :
          name => replace(replace(tostring(value), "$PUBLIC_BASE_URL", local.public_base_url), "$ACCOUNT_ID", var.account_id)
        }
      },
    )
  ]
  gatekeeper_bindings_router = [
    for short, gatekeeper in local.deployed_gatekeepers : {
      type    = "service"
      name    = "GATEKEEPER_${upper(short)}"
      service = local.worker_name[gatekeeper.pkg]
    }
  ]

  # --- Secrets the manifest asks for ----------------------------------------------------------

  # "$SECRET(NAME)" -> NAME, for every secret_text binding of every deployed worker.
  secret_requirements = flatten([
    for pkg in local.all_pkgs : [
      for binding in local.workers_m[pkg].bindings : {
        pkg     = pkg
        short   = try(local.gatekeeper_pkgs[pkg], null)
        binding = binding.name
        name    = try(regex("^\\$SECRET\\((.+)\\)$", binding.text)[0], null)
      } if binding.type == "secret_text"
    ]
  ])
  # Names only; whether a value is present is not itself secret, so the sensitivity is dropped to let
  # the plan error say which are missing.
  missing_secrets = nonsensitive([
    for requirement in local.secret_requirements :
    "${requirement.short}: ${coalesce(requirement.name, requirement.binding)}"
    if try(var.gatekeeper_secrets[requirement.short][requirement.name], null) == null
  ])

  # --- Placeholder audit ----------------------------------------------------------------------

  # The release's placeholder set is closed; anything else still containing "$" after resolution
  # would reach a Worker as a literal, so the preflight check refuses it.
  unresolved_bindings = flatten([
    for pkg in local.all_pkgs : [
      for binding in local.workers_m[pkg].bindings : "${pkg}: ${binding.name}"
      if(
        binding.type == "kv_namespace" ? binding.namespace_id != "$KV_${binding.name}_ID" :
        binding.type == "r2_bucket" ? binding.bucket_name != "$R2_${binding.name}_NAME" :
        binding.type == "service" ? !can(regex("^\\$WORKER_NAME\\(.+\\)$", binding.service)) :
        binding.type == "secret_text" ? !can(regex("^\\$SECRET\\(.+\\)$", binding.text)) :
        strcontains(jsonencode(binding), "$")
      )
    ]
  ])
  unresolved_vars = flatten([
    for pkg in local.all_pkgs : [
      for name, value in local.manifest_vars[pkg] : "${pkg}: ${name}" if strcontains(value, "$")
    ]
  ])
  unknown_service_targets = flatten([
    for pkg in local.all_pkgs : [
      for binding in local.workers_m[pkg].bindings : "${pkg}: ${binding.name}"
      if binding.type == "service" && !contains(keys(local.worker_name), try(regex("^\\$WORKER_NAME\\((.+)\\)$", binding.service)[0], ""))
    ]
  ])

  # --- Checksums ------------------------------------------------------------------------------

  module_problems = flatten([
    for pkg in local.all_pkgs : [
      for module in local.workers_m[pkg].modules : "${pkg}: ${module.name}"
      if try(filesha256("${local.release_dir}/modules/${module.sha256}") != module.sha256, true)
    ]
  ])

  # --- Names ----------------------------------------------------------------------------------

  bucket_name_problems = [
    for key, name in local.bucket_names : "${name} (${key})"
    if length(name) < 3 || length(name) > 63
  ]
  names_unique = (
    length(distinct(values(local.bucket_names))) == length(values(local.bucket_names)) &&
    length(distinct(values(local.kv_titles))) == length(values(local.kv_titles))
  )

  # The uploader invocation; `deploy` or `delete` is appended. Overridable (var.uploader_command).
  deploy_script = coalesce(var.uploader_command, "node '${abspath("${path.module}/../../../../scripts/terraform/deploy-worker.ts")}'")
}
