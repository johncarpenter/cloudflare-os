<!--
Sync Impact Report
- Version change: (unversioned template) → 1.0.0
- Modified principles: none (initial adoption; all principles new)
- Added sections: Core Principles I–VII; Fork Status & Constraints; Development Workflow &
  Quality Gates; Governance
- Removed sections: none (template placeholders replaced)
- Follow-up TODOs: none. No placeholders deferred.
- Sources: AGENTS.md (primary), REVIEW.md, CONTRIBUTING.md-level conventions as summarized there.
- Downstream note: specs/001-clerk-tenant-identity/spec.md still contains an assumption about
  keeping changes small to ease upstream merges; see "Fork Status & Constraints" (not edited here).
-->
# Cloudflare SaaS Constitution

This project is a fork of Cloudflare OS, built into a multi-tenant platform for "vibe coded"
personal applications and AI agents that run inside a strong sandbox. `AGENTS.md` is the
authoritative description of the architecture and conventions; this constitution turns its
non-negotiable rules into governance. Where the two differ, amend one so they agree.

## Core Principles

### I. The Kernel Bar
`packages/workshop-backend` and the API in `packages/workshop-shared/src/api.ts` are the kernel.
They define the architecture and are held to a higher standard than UI or gatekeeper code.

- Kernel diffs MUST be small and elegant; reviewers read every line.
- Every exported member of the `workshop-shared` public API (types, consts and functions) MUST have
  a doc comment.
- A hand-written interface that mirrors an RPC interface plus an `as unknown as` cast MUST NOT be
  introduced. Derive from the real type, or rethink the design.
- A change MUST reuse an existing mechanism rather than add a parallel one. If it adds one, the
  change description MUST say why the existing mechanism did not fit.
- A large kernel change MUST be split by concern, and at minimum commits MUST be grouped so that
  `workshop-backend`/`workshop-shared` can be reviewed apart from UI.

Rationale: the kernel is the trust boundary of the whole platform; review effort is the scarce
resource, so fewer kernel lines is a security property.

### II. Capability-Based Security (NON-NEGOTIABLE)
Authority comes only from capabilities the user or admin explicitly granted.

- A resource becomes ambient (auto-injected) only through user or admin configuration. A
  gatekeeper MUST NOT assert its own ambience.
- Every path that mints a gatekeeper capability MUST pass through `#assertResourceEnabled()` in
  `packages/workshop-backend/src/user.ts`.
- Authentication and authorization config (sign-in providers, password-login switches, and any
  tenant-pinning mode) MUST stay environment-variable driven and MUST NOT move into `AdminConfig`,
  so a compromised admin session cannot change it.
- `AdminSettings` is the only writer of `AdminConfig`; all other code reads through
  `readAdminConfig(env)`.
- Credentials and broad tokens MUST stay with the gatekeeper and MUST NOT reach gadgets or agents.
  Reads are observations (`authorizeObservation()`); side effects are queued actions
  (`submitAction()`). Where a trust boundary exists (for example `tools.ts` in `mcp-shared`),
  nothing outside it may read the data it guards.
- Identity and tenancy decisions MUST rest on verified server-side facts. Client-reported values
  (for example `reportedUserId`) MUST NOT be used to make a decision.

Rationale: the product's selling point is a controlled environment; any ambient or self-asserted
authority breaks that promise.

### III. Cap'n Web RPC Discipline
- RPC interface implementations MUST use `@validateRpc()`; code MUST NOT duplicate the checks
  capnweb-validate already provides.
- Code MUST use promise pipelining where possible; unawaited RPC promises used as stubs or
  arguments are intentional.
- RPC stubs MUST be disposed (`Symbol.dispose`, a `using` declaration, or a `useEffect` cleanup).
- A React `useState` value that holds an `RpcStub` MUST be wrapped in an object, because the setter
  would call the stub.

Rationale: these four mistakes fail silently as server-side leaks or wrong behaviour.

### IV. Observability Without Leakage
- Server code MUST log through `@gadgets/observability/logger` with a module-scoped logger, a
  stable dot-separated `component` (plus `vendorId` for gatekeepers), concrete event names and
  typed fields. Caught values are passed as `error`.
- Logs, reports, thrown error messages and metric attributes MUST NOT contain secrets, prompts,
  headers, tokens, or request/response bodies.
- Failures that need an external issue report use `reportIssue(...)`; usage metrics go through
  `@gadgets/observability/metrics`.
- Frontend error reporting is opt-in, installed only in trusted first-party surfaces, and never
  conveys authority. Gatekeeper UIs report only by `postMessage` to the Workshop host.
  `pageLocation` is origin and pathname only.

Rationale: operability must not create a second path for sensitive data to leave the system.

### V. Frontend Conventions
- Anyone creating, materially changing, moving or reviewing React code under `packages/` MUST load
  the `frontend-conventions` skill first.
- UI MUST use Kumo components and semantic tokens; shared patterns belong in `@gadgets/ui`, not
  reimplemented per app. No custom color literals or wrappers that only restyle Kumo.
- Code is organised by product ownership before implementation type, with PascalCase component
  files, camelCase hook and module files, and colocated tests.
- Effects MUST be limited to synchronising with external systems. Keyboard behaviour, focus
  management and accessible names MUST be preserved.

Rationale: a consistent, accessible UI stays maintainable with a small team.

### VI. Verified, Meaningful Tests
- Tests MUST protect observable behaviour, product rules, accessibility, state transitions, races
  and failure paths, and MUST NOT exist only for coverage or to test framework behaviour.
- Security boundaries (tenant isolation, capability checks, sign-in refusal) MUST have tests that
  attempt the forbidden action and assert refusal.
- Work is not done until the changed path has been exercised, not only unit-tested.

Rationale: boundary bugs are invisible to happy-path tests.

### VII. Configuration and Release Integrity
- `cloudflare.config.ts` is the source of truth for each Worker; the generated `wrangler.jsonc`
  MUST NOT be edited by hand. `pnpm configs:check` MUST pass.
- Durable Object migrations stay tagged in the config's `migrations` export.
- Release manifest changes MUST regenerate and review the golden file.
- Build tasks MUST declare every output-affecting environment variable; the repo's cached-task
  rules (REVIEW.md, "Build system") MUST be respected.
- The package manager is pnpm. Package builds and tests run through the repo's Vite+ tasks.

Rationale: deployments are produced from these artifacts; silent drift ships wrong infrastructure.

## Fork Status & Constraints

- This is a permanent fork. There is no plan to merge changes back to the upstream Cloudflare OS
  repository, and upstream drift is accepted.
- Changes MUST NOT be shaped to minimise upstream conflicts or preserve upstream compatibility.
  Choose the cleanest design for this product, migrate every caller, and remove obsolete code
  rather than leaving shims.
- Fork status does not lower the bar in Principles I–VII. Kernel simplicity, capability security
  and review hygiene apply to this repository in their own right, not as a courtesy to upstream.
- Product decisions recorded in `docs/specs/Cloudflare OS SaaS — Design & Handoff.md` marked
  *Decided* are requirements; *Proposed* are defaults; *Open* items MUST be raised before the
  affected part is built.
- The project architecture in `AGENTS.md` (package roles, gatekeeper model, admin settings,
  release pipeline) is binding context for every plan and task list.

## Development Workflow & Quality Gates

- `pnpm lint` MUST pass before pushing; it includes script types, generated-config checks and the
  workspace build. Use `pnpm --filter <package> test:run` while iterating and `pnpm test` for
  workspace verification.
- Gatekeeper work MUST follow the `write-gatekeeper` skill, including its mandatory stop for API
  review before implementation.
- Server logging, RPC and frontend rules above are review criteria; reviewers (human or AI) apply
  `REVIEW.md`, with the kernel bar and capability-security invariants ranked highest.
- Generated files (`packages/*/src/generated/**`, `dist/`) are never edited by hand or reviewed.
- Plans MUST pass a constitution check against Principles I–VII; any violation MUST be listed with
  a justification in the plan's complexity-tracking section.

## Governance

- This constitution supersedes other practice documents where they conflict. `AGENTS.md`,
  `REVIEW.md` and the skills it references are the detailed guidance it points to.
- Amendments MUST be made by pull request that updates this file, states the reason, and updates
  any dependent guidance in the same change or records it as follow-up.
- Versioning follows semantic versioning: MAJOR for removing or redefining a principle in a
  backward-incompatible way, MINOR for adding a principle or materially expanding guidance, PATCH
  for clarifications and wording.
- Every plan, task list and pull request review MUST verify compliance with these principles;
  unjustified violations block merge.

**Version**: 1.0.0 | **Ratified**: 2026-10-13 | **Last Amended**: 2026-10-13
