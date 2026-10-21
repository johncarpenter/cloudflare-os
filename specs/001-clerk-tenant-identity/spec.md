# Feature Specification: Clerk Sign-In and Tenant Identity

**Feature Branch**: `001-clerk-tenant-identity`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "I would like to add the saas capabilities and clerk front end to the app, follow the directions under docs/specs/Cloudflare OS SaaS — Design & Handoff.md. This spec will just cover the clerk/user management, the data catalog will come in a different spec"

**Source design record**: `docs/specs/Cloudflare OS SaaS — Design & Handoff.md` (work packages WP1, WP2 and WP3). Items it labels *Decided* are requirements here; *Proposed* items are the defaults; *Open* items were resolved with the product owner on 2026-10-13 (see Assumptions).

## Clarifications

### Session 2026-10-13

- Q: Who may use the deployment-wide /admin panel in the shared pool? → A: Only product operators, identified by deployment configuration rather than Clerk; it applies to every tenant. Organization admins manage members only.
- Q: What happens to a departing member's content in an organization workspace? → A: The organization keeps it and their own access ends; their connected-account credentials are revoked; organization admins can view and reassign it (reassignment later deferred; see next entry).
- Q: Is organization-admin view/reassign of a departed member's content in scope for this spec? → A: No, deferred to a follow-up spec (approved 2026-10-13); content is retained and credentials revoked.
- Q: Which workspace opens first for a user who belongs to organizations? → A: The one last used, remembered per account across devices; falls back to the personal workspace if that membership no longer exists.
- Q: What happens to a user's data when their account is deleted? → A: Their personal workspace is erased; content they created in organizations stays with the organization, as when leaving.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign up and sign in with a personal workspace (Priority: P1)

A new individual visits the product, creates an account, and lands in the Workshop with their own private workspace. They have no organization and do not need one. On later visits they sign in again and find their gadgets, chats and connected accounts exactly as they left them, even if they have since changed their email address.

**Why this priority**: This is the B2C entry path and the minimum that makes the product usable as a SaaS. Every other story builds on a signed-in identity that maps to a stable tenant.

**Independent Test**: Create a new account through the sign-up screen, create a gadget, sign out, sign back in, and confirm the gadget is present. Change the account's email address, sign in again, and confirm the same workspace appears.

**Acceptance Scenarios**:

1. **Given** a visitor with no account, **When** they complete sign-up, **Then** they arrive in the Workshop in a personal workspace that only they can access.
2. **Given** a returning user, **When** they sign in, **Then** they see the same workspace content as their previous session.
3. **Given** a user who has changed their email address, **When** they sign in, **Then** they reach the same workspace as before, not a new empty one.
4. **Given** a visitor who is not signed in, **When** they request any Workshop page or data, **Then** they are shown the sign-in screen and receive no workspace data.
5. **Given** a user whose session has expired or been revoked, **When** they take any action, **Then** the action is refused and they are returned to sign-in.

---

### User Story 2 - Work inside an organization (Priority: P2)

A team member belongs to an organization. When they have that organization active, they work in the organization's shared workspace; the organization is a separate tenant from their personal workspace and from every other organization. They can create an organization, invite colleagues, and see who belongs to it, using the product's own screens rather than leaving to a separate site.

**Why this priority**: Organizations are the B2B and Pro-team path (1–5 users) and the unit that quotas and isolation later attach to. It is secondary only because B2C sign-in must work first.

**Independent Test**: Create an organization, invite a second account, accept the invitation from that account, and confirm both see the organization's workspace while neither sees the other's personal workspace.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they create an organization, **Then** that organization becomes their active workspace and is empty.
2. **Given** an organization member, **When** they open the Workshop with that organization active, **Then** they see the organization's workspace, and their personal workspace content is not shown.
3. **Given** an organization admin, **When** they invite a colleague by email, **Then** the colleague can accept and join, and then sees the organization workspace.
4. **Given** a user removed from an organization, **When** they next take any action in that organization's workspace, **Then** it is refused, and they fall back to their personal workspace.
5. **Given** two users in different organizations, **When** either works in their workspace, **Then** neither can see, open or modify anything belonging to the other's organization.

---

### User Story 3 - Dedicated single-organization deployment (Priority: P3)

An operator runs an Enterprise deployment dedicated to one customer organization. The deployment is configured with that organization's identity. Members of that organization sign in and work normally; anyone else, including people with valid accounts in other organizations or with no organization, is refused. In this mode nothing about the product's behaviour changes compared with today for the people who are allowed in.

**Why this priority**: Enterprise isolation is a decided part of the commercial model, but it ships after the shared pool works and is mostly a configuration of the same capability.

**Independent Test**: Configure a deployment as dedicated to organization A. Sign in as a member of A and confirm normal use. Sign in as a member of organization B and as a user with no organization, and confirm both are refused with no data exposed.

**Acceptance Scenarios**:

1. **Given** a deployment dedicated to organization A, **When** a member of A signs in, **Then** they work in A's workspace as normal.
2. **Given** the same deployment, **When** a user whose active organization is B or who has no active organization signs in, **Then** they are refused with a clear message and no workspace is created for them.
3. **Given** the same deployment, **When** an A member holds a valid session with a different organization active, **Then** every request is refused until they switch back to A.

---

### User Story 4 - Keep tenants apart when sharing (Priority: P2)

A user shares a gadget or chat with a colleague, either by adding them directly or by handing out a share link. Sharing works within the same tenant. Attempts to add a person from another tenant, or to redeem a share link while signed in to another tenant, are refused.

**Why this priority**: In the shared pool, tenant isolation is a security boundary; without this, a guessed username or leaked link exposes one customer's work to another. Tenant-scoped sharing and connected-account isolation (design record WP3) are in scope for this spec, so every gatekeeper must scope its stored data and credentials by tenant.

**Independent Test**: As a user in tenant A, try to add a user from tenant B as a collaborator and try to open a tenant A share link while signed in to tenant B; both must be refused. Repeat within tenant A and confirm both succeed.

**Acceptance Scenarios**:

1. **Given** a user in tenant A, **When** they add a collaborator who belongs to tenant B, **Then** the add is refused with a message that does not reveal whether the person exists.
2. **Given** a share link created in tenant A, **When** a signed-in user of tenant B redeems it, **Then** access is refused.
3. **Given** a share link created in tenant A, **When** a signed-in member of tenant A redeems it, **Then** access is granted as before.
4. **Given** two tenants that each connect an external account, **When** either uses its connection, **Then** credentials and data stay separate and neither tenant can reach the other's.

---

### User Story 5 - Move between workspaces and manage my account (Priority: P3)

A signed-in user can see which workspace is active, switch between their personal workspace and any organizations they belong to, edit their profile, and sign out, all from within the Workshop.

**Why this priority**: Required for a complete user-management experience, but only relevant once a user can belong to more than one workspace. One person can belong to several pooled tenants (their personal workspace plus any organizations) and switch between them.

**Independent Test**: As a user with a personal workspace and one organization, switch between them from the Workshop header and confirm the content shown changes each time; open the profile screen, change the display name, sign out.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they look at the Workshop header, **Then** they can see their identity and which workspace is active.
2. **Given** a user who can belong to several workspaces, **When** they switch to another, **Then** the Workshop reloads with that workspace's content and nothing from the previous one remains visible.
3. **Given** a signed-in user, **When** they choose sign out, **Then** their session ends on this device and the sign-in screen is shown.
4. **Given** a signed-in user, **When** they open account settings, **Then** they can view and update their profile and security details.

---

### Edge Cases

- A user's email address changes, or two tenants contain accounts with the same email: identity must follow the account, never the email, so these never merge or split workspaces.
- A user is removed from an organization, or the organization is deleted, while they have the Workshop open: their next request must be refused and long-lived connections must end promptly rather than continue to serve data.
- A user switches active organization in one tab while another tab is open: the other tab must not keep serving the previous workspace's data under the new identity.
- A request carries a missing, malformed, expired, tampered or wrong-audience session credential: it is refused and no workspace is created as a side effect.
- The identity provider is unavailable: new sign-ins fail with a clear message; already-valid sessions keep working only for as long as their credentials remain valid.
- A user with no organization signs in to a dedicated single-organization deployment: refused, not given a personal workspace.
- A user is banned or locked at the identity provider: all their sessions stop working.
- Opaque, unguessable identifiers are used where a workspace identifier appears in storage or URLs; no workspace can be addressed by guessing another's name.

## Requirements *(mandatory)*

### Functional Requirements

**Sign-in and identity**

- **FR-001**: The system MUST let a visitor create an account and sign in using Clerk as the identity provider, through screens presented within the Workshop's own interface.
- **FR-002**: The system MUST verify the signed-in session on every request and every long-lived connection, and MUST refuse any request whose session is missing, invalid, expired, revoked or issued for a different application.
- **FR-003**: The system MUST identify a user by their permanent account identifier, not by email address, so that changing an email address never changes which workspace the user reaches.
- **FR-004**: An unauthenticated visitor MUST see only the sign-in and sign-up screens and MUST receive no workspace data.
- **FR-005**: Users MUST be able to sign out, ending their session on the current device.

**Tenants**

- **FR-006**: The system MUST resolve a *tenant* for every authenticated request, derived from the user's active Clerk organization; a user with no active organization MUST be given a personal tenant.
- **FR-006a**: The system MUST remember each user's last-used workspace per account (not per device) and open it at sign-in; if the user no longer belongs to it, it MUST open their personal workspace instead. In dedicated mode this does not apply.
- **FR-007**: Each tenant MUST be a hard isolation boundary: a user acting in one tenant MUST NOT be able to read, list, open or modify any data belonging to another tenant.
- **FR-008**: A user's workspace state MUST be keyed by the combination of tenant and user, so the same person in two tenants has two independent workspaces and two people in the same tenant have separate ones.
- **FR-009**: Tenant resolution MUST happen in a single place that all tenant-dependent code consults, so that tenant behaviour can be changed or audited in one location.
- **FR-010**: Tenant identifiers MUST be opaque and non-guessable when exposed in storage names, URLs or logs.

**Organizations**

- **FR-011**: Users MUST be able to create an organization, invite members by email, view the member list, and leave an organization from within the Workshop.
- **FR-012**: Organization admins MUST be able to change member roles and remove members from within the Workshop.
- **FR-012a**: Deployment-wide administration (the Workshop's admin panel) MUST be available only to product operators named in deployment configuration. Clerk organization roles, including organization admin, MUST NOT grant it. Operator status MUST NOT be changeable from within the Workshop.
- **FR-013**: When a user's membership in the active organization ends, the system MUST refuse that user's next request in that organization and MUST end their open long-lived connections to it.
- **FR-013a**: When a member leaves or is removed, their gadgets and chats in that organization MUST remain in the organization (not be deleted) and stay reachable to people they were already shared with. Their connected-account credentials MUST be revoked, and anything that depended on them MUST report a clear "connection removed" state rather than fail silently. Organization-admin view and reassignment of that content is deferred to a follow-up spec.

**Dedicated (single-tenant) deployments**

- **FR-014**: A deployment MUST be configurable as dedicated to exactly one organization; in that mode the system MUST refuse every session whose active organization is not that one, including sessions with no organization.
- **FR-015**: In dedicated mode the system MUST NOT create personal tenants, and MUST behave identically to the shared deployment for permitted users.
- **FR-016**: Existing deployments that do not enable Clerk sign-in MUST continue to behave exactly as they do today.

**Account deletion**

- **FR-013b**: When a user's account is deleted at the identity provider, the system MUST erase that user's personal tenant and revoke their connected-account credentials everywhere, and MUST treat their organization memberships as ended per FR-013a. The erasure MUST be audited per FR-021.
- **FR-013c**: When an organization is deleted at the identity provider, the system MUST erase every member's data in that tenant (workspaces, published blueprints, connected-account credentials, directory entries) and MUST NOT let a session issued before the deletion recreate any of it. Other tenants MUST be untouched. Members whose sign-in never reached the tenant's directory cannot be found and are not erased.

**Sharing and connected accounts**

- **FR-017**: The system MUST refuse to add a collaborator from a different tenant, and MUST refuse redemption of a share link by a user of a different tenant. Refusal messages MUST NOT reveal whether the other person or link exists.
- **FR-018**: Credentials and data for connected external accounts MUST be stored per tenant and per user, so one tenant can never use or read another's connections.

**Account management**

- **FR-019**: A signed-in user MUST be able to see their identity and active workspace in the Workshop, and view and update their profile and security settings.
- **FR-020**: A signed-in user MUST be able to switch between the workspaces they belong to without signing out.

**Observability and safety**

- **FR-021**: The system MUST record sign-in refusals, tenant mismatches and membership removals as audit events that include the tenant and user identifiers but never session credentials or other secrets.

### Key Entities *(include if feature involves data)*

- **User**: A person with a permanent account identifier issued by the identity provider. Has a profile (name, email) that can change over time; the identifier never does.
- **Organization**: A group of users managed in the identity provider, with members and roles (admin, member). An organization maps to exactly one tenant.
- **Tenant**: The unit of isolation and, later, of quota. Either an organization or a user's personal tenant. Has an opaque identifier. Owns all workspace data created while it is active.
- **Personal tenant**: The tenant created for a user who has no organization; owned by one user.
- **User workspace**: A user's gadgets, chats, settings and connected accounts inside one tenant. Identified by tenant plus user.
- **Session**: A signed-in browser session carrying the user, their active organization and their role in it. Expires and can be revoked.
- **Deployment mode**: Either *shared* (many tenants resolved per request) or *dedicated* (one fixed tenant).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new visitor can go from the landing page to a usable, empty workspace in under 2 minutes.
- **SC-002**: 100% of requests without a valid session are refused and return no workspace data, verified across every entry point the Workshop exposes.
- **SC-003**: In an automated cross-tenant test suite covering every operation the Workshop offers on workspace data, 0 operations succeed against another tenant's data.
- **SC-004**: A user who changes their email address reaches their original workspace on the next sign-in in 100% of cases.
- **SC-005**: After a member is removed from an organization, their open sessions are refused within 60 seconds in 100% of tested cases.
- **SC-006**: In a dedicated deployment, 100% of sessions from other organizations or with no organization are refused, and permitted users notice no behaviour change versus a deployment without tenants.
- **SC-007**: A signed-in user can switch workspaces, edit their profile, or sign out in no more than 3 interactions from any Workshop screen.
- **SC-008**: Deployments that do not enable the new sign-in show no change in sign-in behaviour or stored data.

## Assumptions

- Resolved with the product owner: tenant-scoped sharing and connected-account isolation (WP3) are in scope; one user may belong to several pooled tenants and switch between them.
- This spec covers identity, organizations, tenant resolution and the sign-in front end only. Usage meters and quotas, Clerk Billing and plans, data upload, the data lake, the context lake and the blueprint catalog are separate specs and are out of scope; billing and quotas will later attach to the tenant defined here.
- Clerk is the single identity provider for the shared SaaS deployment. Password, access-proxy and other sign-in methods remain available only to deployments that do not enable Clerk; the SaaS deployment does not offer them alongside Clerk.
- Plans and plan limits (Free, Pro of 1–5 users, Enterprise) do not affect this feature; any user may create an organization and enforcing member limits is deferred to billing.
- The SaaS deployment is new and has no existing email-keyed users or data to migrate. Import of existing users and data is out of scope.
- Social or enterprise single sign-on configuration is managed in the Clerk dashboard and needs no product changes beyond what Clerk provides.
- Moving a tenant between the shared pool and a dedicated deployment (tenant export/import) is a separate spec. Erasure on account deletion (FR-013b) is in scope; bulk export for portability is not.
- This is a permanent fork with no plan to merge upstream (project constitution, Fork Status). Tenant resolution is still a single consulted point for auditability, but nothing is shaped to minimise upstream conflicts.
- Standard web expectations apply to performance and availability: pages load in a few seconds on a typical connection, and sign-in depends on the identity provider's availability.
