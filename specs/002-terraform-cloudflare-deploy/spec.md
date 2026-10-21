# Feature Specification: Terraform Deployment to Cloudflare

**Feature Branch**: `002-terraform-cloudflare-deploy`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "We will need to be able to deploy the application onto cloudflare. Can you create the terraform deployment to launch the components. https://github.com/cloudflare/cloudflare-os-starter is a demo project that configures using wrangler. We would like that within terraform instead."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Launch a complete instance into an empty Cloudflare account (Priority: P1)

An operator has a Cloudflare account with a domain in it, a Clerk application, and the product's release artifacts. They fill in one configuration file, review a plan that lists everything that will be created, and apply it. At the end the product is live on their domain: sign-in works, the Workshop loads, and the pre-installed integrations (the context library and the scheduler) are available to agents. They do not use the Cloudflare dashboard or a Wrangler command to create or wire anything.

**Why this priority**: This is the whole point of the feature. Without a repeatable way to stand the product up, there is no way to run the SaaS, a customer silo, or even a staging environment.

**Independent Test**: In a clean Cloudflare account, supply the configuration for a new instance, apply it, open the public address, sign in through Clerk, create a workspace and have an agent use the context library. Nothing outside the prerequisites (zone, Clerk application, release artifacts) was created by hand.

**Acceptance Scenarios**:

1. **Given** a valid configuration and release, **When** the operator applies it to an empty account, **Then** every component the product needs exists, is connected to the others, and the public address serves the application.
2. **Given** a completed apply, **When** the operator reads the deployment's outputs, **Then** they get the public address and the exact values they must enter in Clerk (the webhook endpoint and the allowed origin) without consulting other documents.
3. **Given** a configuration with a missing or malformed value, **When** the operator asks for a plan, **Then** it fails before anything is created, naming each problem.
4. **Given** a configuration naming a domain that is not in the operator's account, **When** the operator asks for a plan, **Then** it is refused with a message saying so.

---

### User Story 2 - Change and re-apply safely (Priority: P1)

An operator edits the configuration later (adds an administrator, changes the display of a setting, rotates a secret, enables observability) and re-applies. Only what actually changed is updated. Stored data, existing user accounts and workspaces are untouched, and the plan shows exactly what will change before anything happens.

**Why this priority**: A deployment that cannot be changed safely is a one-shot script, not infrastructure. Data loss on re-apply would also be a security and trust failure for a product whose selling point is control.

**Independent Test**: Apply a deployment, create data in it, change one setting, re-apply, and confirm the plan listed only that change and the data is intact.

**Acceptance Scenarios**:

1. **Given** an applied deployment and no configuration change, **When** the operator plans again, **Then** the plan reports no changes.
2. **Given** an applied deployment, **When** the operator changes one value, **Then** the plan names only the resources affected and the apply leaves all stored data in place.
3. **Given** a change that would rename or replace a component that holds data, **When** the operator plans, **Then** the plan makes the data-bearing replacement unmistakable, and the apply refuses to proceed unless the operator explicitly accepts it.
4. **Given** a secret is rotated in the configuration, **When** the operator applies, **Then** the new value reaches the affected components and nothing else changes.

---

### User Story 3 - Keep the public identity stable (Priority: P1)

The public address and the sharing boundary derived from it must not change by accident. An operator who edits the domain in a way that would silently hide existing context data, or break sign-in redirects, is stopped before applying.

**Why this priority**: The context library scopes its data by the deployment's public address; changing it makes existing collections disappear without an error. This is a data-visibility failure the operator cannot see until users complain.

**Independent Test**: Apply a deployment, change the public address in the configuration, and confirm the plan is blocked with an explanation unless the operator overrides it explicitly.

**Acceptance Scenarios**:

1. **Given** an applied deployment, **When** the configured public address changes, **Then** the plan is refused with an explanation of the consequence, unless the operator sets an explicit acknowledgement.
2. **Given** a custom domain and an explicit public address that disagree, **When** the operator plans, **Then** it is refused.

---

### User Story 4 - Upgrade to a new release and roll back (Priority: P2)

An operator points the deployment at a newer release of the product, reviews the plan, and applies. Components are updated in an order that never leaves the public router pointing at a backend or integration that does not exist yet. If the new release misbehaves, pointing the configuration back at the previous release and applying restores it.

**Why this priority**: Operators need to take security fixes and features. It matters slightly less than launch and safe change because it builds on both.

**Independent Test**: Deploy release A, then release B, then release A again; confirm the application stays available throughout the changes that do not involve a data migration, and that stored data survives both moves.

**Acceptance Scenarios**:

1. **Given** a running deployment on release A, **When** the operator selects release B and applies, **Then** every component runs release B and the plan showed which components change.
2. **Given** release B changes a component's data-store schema migration list, **When** the operator applies, **Then** migrations are applied in order exactly once, never reordered or rewritten.
3. **Given** a deployment on release B, **When** the operator selects release A and applies, **Then** the deployment returns to release A's code with data intact, or the plan states clearly that a migration prevents going back.
4. **Given** a release whose files do not match their recorded checksums, **When** the operator plans, **Then** it is refused.

---

### User Story 5 - Choose which integrations are installed (Priority: P2)

The operator decides which gatekeeper integrations the deployment includes beyond the always-on ones. For each integration they enable that needs third-party credentials, they supply those credentials once in the configuration. Enabling or disabling an integration changes only what is needed for it, including the router's ability to reach it.

**Why this priority**: Different deployments want different integrations (a pool for individuals, a silo for a bank). It is required for real use, but the product works with the two defaults alone.

**Independent Test**: Enable one extra integration with its credentials, apply, and confirm it appears and connects in the Workshop; disable it and confirm it is removed and nothing else is disturbed.

**Acceptance Scenarios**:

1. **Given** the context library and the scheduler, **When** nothing else is configured, **Then** exactly those two integrations are installed.
2. **Given** an enabled integration that requires credentials and none are supplied, **When** the operator plans, **Then** it is refused naming the missing values.
3. **Given** an integration is enabled and later disabled, **When** the operator applies, **Then** its component is removed from routing and from the deployment, and any data it holds is treated like any other data-bearing component (see Edge Cases).

---

### User Story 6 - Run several instances from the same configuration model (Priority: P2)

The operator runs one shared pool for individuals and small teams, plus a separate dedicated instance for each enterprise customer, each in its own naming space and with its own storage, and each pinned to a single organization where applicable. They create them from the same configuration model, changing only the values that differ.

**Why this priority**: The commercial model requires this (pool plus silos), but the first instance has to work before the second matters.

**Independent Test**: Create two instances in one account (or two accounts) from the same model with different names; confirm neither can see, collide with, or modify the other's components or data.

**Acceptance Scenarios**:

1. **Given** two instances with different names, **When** both are applied, **Then** their components, storage and addresses are distinct and neither plan touches the other's resources.
2. **Given** an instance configured as dedicated to one customer organization, **When** it is applied, **Then** it admits only that organization's members.
3. **Given** two instances whose names would collide, **When** the operator plans, **Then** it is refused.

---

### User Story 7 - Tear down without losing data by accident (Priority: P3)

An operator removes an instance. Components that hold user data (workspaces, documents, stored files) are protected: removing the instance does not delete them unless the operator explicitly confirms that deletion.

**Why this priority**: Rarely needed, but a one-keystroke irreversible data loss is the worst failure in this area.

**Independent Test**: Apply, add data, ask for a teardown without confirmation and confirm it is stopped; ask again with the confirmation and confirm everything is removed.

**Acceptance Scenarios**:

1. **Given** a deployment with data, **When** the operator asks to destroy it without the explicit confirmation, **Then** the destroy is refused before anything is deleted.
2. **Given** the explicit confirmation, **When** the operator destroys the deployment, **Then** all its components and data stores are removed and no resources of other instances are touched.

---

### Edge Cases

- The apply is interrupted partway (network loss, provider error): re-running it must converge without creating duplicates or leaving a component pointing at something missing.
- A component name already exists in the account (created by hand, or by the earlier Wrangler flow): the plan must say so, and there must be a documented way to adopt it rather than fail opaquely.
- The domain's zone is in a different account, or the operator's credentials lack a needed permission: the failure names the missing access.
- A capability the product needs is not yet manageable through Terraform (for example a beta-only binding): the deployment must degrade the same way the product already does without it and say so in the plan, rather than silently omitting it.
- A secret changes: only components that use it update, and the secret never appears in plan output, logs, outputs or committed files.
- An integration that holds data is disabled: removal is treated as a data-bearing replacement requiring explicit confirmation.
- Release artifacts are missing or incomplete (the release was never finished): refused before any change.
- Account limits are reached (storage buckets, workers): the failure message states the limit.
- The same configuration is applied from two machines at once: the second is stopped by state locking rather than racing.
- Someone changes a deployed component by hand in the dashboard: the next plan shows the drift and offers to restore the declared state.

## Requirements *(mandatory)*

### Functional Requirements

**Provisioning**

- **FR-001**: The system MUST provision every component of a working instance from one configuration: the public router that serves the web application, the Workshop backend, the pre-installed integrations (context library, scheduler), all key-value and object storage they need, their connections to one another, their data-store migration history, their runtime settings, and the public address.
- **FR-002**: The system MUST NOT require the operator to run Wrangler, build per-component configuration files, or use the Cloudflare dashboard to create or connect components.
- **FR-003**: The system MUST deploy from an already built and published release of the product (it MUST NOT build from source), read from the release's own manifest, so the set of components, their connections and their migration history always match the release and are never restated by hand.
- **FR-004**: The system MUST provision components so that no component is ever pointed at one that does not exist yet, in both first launch and later upgrades.
- **FR-005**: Only the router MUST have a public address; every other component MUST be reachable only through connections from other components.

**Configuration and validation**

- **FR-006**: The system MUST take its input from a single documented configuration with an example, and MUST validate it before any change: required values present, no placeholders left, names unique and well-formed, domain well-formed and present in the account, and mutually dependent values consistent.
- **FR-007**: Every validation failure MUST name the offending value and what is wrong.
- **FR-008**: The configuration MUST cover: the account, the instance name and component names, the public domain (or a free evaluation address), the identity provider settings (see below), the operators, the tenancy mode, optional AI settings, observability and error-reporting settings, and the integrations to install.

**Identity and tenancy**

- **FR-009**: The system MUST configure the instance for Clerk sign-in: issuer, publishable key, allowed origins, webhook secret, and the operator list, all of which come from the configuration; sensitive values MUST be supplied as secrets.
- **FR-010**: The system MUST support the shared pool and a dedicated single-organization instance, selected by configuration, using the product's existing tenancy settings.
- **FR-011**: The system MUST output the values the operator needs to complete Clerk setup: the public origin and the webhook endpoint address.
- **FR-012**: The release consumed by this feature MUST include a version of the web application suitable for Clerk sign-in; the deployment MUST fail with a clear message if the selected release does not.

**Safety and change management**

- **FR-013**: The system MUST be idempotent: a plan on an unchanged, applied deployment MUST show no changes, and a changed value MUST update only the components that use it.
- **FR-014**: The system MUST prevent, unless explicitly acknowledged, any change that would delete or replace a component holding user data.
- **FR-015**: The system MUST prevent, unless explicitly acknowledged, a change to the public address or to the context data-sharing boundary derived from it.
- **FR-016**: The system MUST refuse to apply a release whose files do not match the checksums in its manifest.
- **FR-017**: The system MUST apply data-store migrations in the release's order, exactly once, and MUST NOT rewrite already-applied migrations.
- **FR-018**: Secrets MUST NOT be written to committed files, plan output, logs or deployment outputs, and the documentation MUST state where they do end up and how to protect that location.
- **FR-019**: The system MUST refuse to destroy components holding user data unless the operator gives an explicit, separate confirmation.

**Integrations**

- **FR-020**: By default the system MUST install exactly the context library and the scheduler.
- **FR-021**: The operator MUST be able to enable any other integration available in the release by name, supplying whatever credentials it needs; the system MUST refuse an enabled integration with missing credentials.
- **FR-022**: Enabling or disabling an integration MUST update only what is needed for it, including the router's ability to reach it.

**Multiple instances**

- **FR-023**: The same configuration model MUST be usable to create several independent instances; instance names MUST determine all component names so that instances cannot collide, and MUST be validated for uniqueness.
- **FR-024**: Instances MUST NOT share storage or components with one another.

**Operations**

- **FR-025**: The system MUST support selecting a different release to upgrade or roll back, with the plan showing which components change.
- **FR-026**: The system MUST document: first launch, upgrade, rollback, secret rotation, adopting pre-existing resources, teardown, remote state and its protection, and the account permissions required.
- **FR-027**: The system MUST expose the instance's observability and error-reporting settings through configuration.

### Key Entities *(include if feature involves data)*

- **Instance**: One deployment of the product: a name, an account, a public address, an identity configuration, a tenancy mode, and a set of components and data stores. Everything it creates is named from the instance name.
- **Release**: An immutable, published build of the product: a manifest listing components, their connections, migration history, settings and checksummed files, plus the web application assets. Chosen by id.
- **Component**: One deployable unit of the product (router, backend, an integration, the error reporter), with its connections, settings, secrets and migration history.
- **Data store**: A key-value namespace, object bucket or durable-object-backed store holding user data. Protected against accidental deletion.
- **Integration**: An optional component that connects the product to an outside service; some need credentials, some are installed by default.
- **Configuration**: The single operator-supplied input describing an instance.
- **Secret**: A sensitive value (identity webhook secret, integration credentials) supplied separately from ordinary settings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator with the prerequisites in hand can take an empty account to a working, signed-in instance in under 30 minutes of their own time, with no manual component creation.
- **SC-002**: A re-plan of an unchanged, applied deployment reports zero changes in 100% of runs.
- **SC-003**: In validation testing, 100% of the invalid configurations in a defined set (missing values, leftover placeholders, name collisions, domain not in the account, missing integration credentials, mismatched public address) are rejected before any resource changes.
- **SC-004**: Changing one setting and re-applying changes only the components that use it, and leaves 100% of stored data (workspaces, accounts, documents) intact, verified by a before-and-after data check.
- **SC-005**: Upgrading to a new release and rolling back preserves 100% of stored data and, for releases with no data-store migration between them, completes with no period in which the public address fails to serve the application.
- **SC-006**: No secret value appears in plan output, apply logs, deployment outputs or any committed file, verified by scanning those for every secret used in a test deployment.
- **SC-007**: Two instances created from the same model in one account share no component, storage or address, and a destroy of one leaves the other fully working.
- **SC-008**: An attempt to destroy a deployment holding data without the explicit confirmation deletes nothing in 100% of runs.

## Assumptions

- The operator already has: a Cloudflare account with the products the application depends on enabled, a domain active in that account (or accepts a free evaluation address), a Clerk application configured per `docs/clerk-signin.md`, and credentials with the permissions this feature documents. Creating the Cloudflare account, the zone or the Clerk application is out of scope.
- The product's release pipeline already produces immutable releases with a manifest and content-addressed files (`scripts/release/`). This feature consumes releases; it does not change how they are built, except that releases must also carry a web application variant suitable for Clerk sign-in (FR-012), since today's releases carry only the Cloudflare Access variant.
- There is no existing production deployment made with the earlier Wrangler-based approach to migrate. Adopting hand-made or Wrangler-made resources is documented as an advanced path (FR-026) rather than automated.
- Clerk is the only sign-in method deployed by this feature. Password, Cloudflare Access and gatekeeper sign-in configuration are not exposed, consistent with Clerk replacing them (see `docs/clerk-signin.md`).
- The starter project's custom example integration and its sample branding are demo content and are not reproduced; its structure for names, hostname, admins, AI, error reporting and observability is the model for the configuration.
- Capabilities of the product that cannot yet be created through the chosen tooling are limited to those already optional or beta in the product; each such gap is listed in the documentation and degrades the way the product already does without it.
- Remote state storage and locking are chosen by the operator; this feature documents the requirement and the risk of secrets in state but does not provide the state backend.
- Teams will use one state per instance, so that an instance can be planned, applied and destroyed on its own.
- Resolved with the product owner (2026-10-14): the deployment consumes a release that was already built and published; it does not build from source. An operator without a published release builds one first with the existing release tooling.
