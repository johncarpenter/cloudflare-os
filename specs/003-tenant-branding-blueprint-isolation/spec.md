# Feature Specification: Tenant Branding and Blueprint Isolation

**Feature Branch**: `003-tenant-branding-blueprint-isolation`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User description: "for a tenant branding and blueprint isolation spec" (following the multi-tenancy discussion: per-organization branding is the only per-tenant configuration for the shared pool, and published blueprints must not cross tenants)

**Builds on**: `specs/001-clerk-tenant-identity` (a tenant is the user's active organization, or a personal tenant). The design record `docs/specs/Cloudflare OS SaaS — Design & Handoff.md` decided: one curated shared catalog maintained by the operator, tenant-private publishing, and no public cross-tenant publishing.

## Clarifications

### Session 2026-10-20

- Q: Is per-tenant configuration limited to branding for the shared pool? → A: Yes. Everything else the operator configures (connectors, models, instructions, signups) stays deployment-wide.
- Q: What does "branding" cover? → A: The site name, the logo and the accent color. Banners and announcements remain operator-only, deployment-wide notices.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Members see their organization's branding (Priority: P1)

A customer organization wants the product to look like theirs. Once a member of that organization signs in and is working in the organization's workspace, they see the organization's name, logo and accent color throughout the product, and the browser tab shows them too. When the same person switches to their personal workspace or to another organization, the branding changes with the workspace. Organizations that never set branding see the deployment's own.

**Why this priority**: This is the visible value of per-tenant branding and the reason to build it. It also has to be right before anyone can set branding, because showing the wrong organization's identity to a user is a trust failure.

**Independent Test**: Give two organizations different branding. Sign in as a member of each and confirm each sees only their own; switch one person between the two and their personal workspace and confirm the branding follows the active workspace each time and never shows the other's.

**Acceptance Scenarios**:

1. **Given** an organization with branding set, **When** a member signs in and works in that organization, **Then** the product shows that organization's name, logo and accent color.
2. **Given** a user who belongs to two organizations with different branding, **When** they switch between them, **Then** the branding switches too, and nothing of the previous organization remains visible.
3. **Given** a user in their personal workspace, **When** they use the product, **Then** they see the deployment's branding.
4. **Given** an organization that has set no branding, **When** a member signs in, **Then** they see the deployment's branding.
5. **Given** a visitor who is not signed in, **When** they reach the sign-in page, **Then** they see the deployment's branding, not any organization's.

---

### User Story 2 - An organization administrator sets and clears the branding (Priority: P1)

An administrator of an organization opens a branding screen for their organization, sets a name, uploads a logo and picks an accent color, sees a preview, and saves. Members see the change the next time they load the product (or sooner). The administrator can also clear any or all of the three and fall back to the deployment's branding. Members who are not administrators cannot change it.

**Why this priority**: Without a way to set it, per-tenant branding does not exist. Restricting who may set it is a security requirement, since branding is shown to every member.

**Independent Test**: As an administrator, set all three, confirm a member sees them and cannot change them; clear one and confirm only that part falls back; confirm a member of another organization sees none of it.

**Acceptance Scenarios**:

1. **Given** an organization administrator, **When** they save a name, a logo and an accent color, **Then** all members of that organization see them.
2. **Given** an organization member who is not an administrator, **When** they try to change the organization's branding, **Then** the attempt is refused and nothing changes.
3. **Given** saved branding, **When** the administrator clears the logo only, **Then** the name and color remain and the logo falls back to the deployment's.
4. **Given** a logo that is not an accepted image type, is too large, or an accent color that is not a valid color, **When** the administrator saves, **Then** the save is refused with a message saying what is wrong, and the previous branding stays.
5. **Given** an administrator of one organization, **When** they act, **Then** they can never read or change another organization's branding.
6. **Given** a member whose administrator role is removed while they have the branding screen open, **When** they save, **Then** the save is refused.

---

### User Story 3 - Blueprints published by an organization stay inside it (Priority: P1)

A member publishes a blueprint (a shareable gadget design). From then on it belongs to their organization: people in that organization can see it, create gadgets from it and take its updates, and nobody outside the organization can, whatever links they hold. This covers the blueprint's details, its downloadable form, the preview image, creating a gadget from it, and later update proposals.

**Why this priority**: Today a blueprint link works for anyone, in any organization, and even for people who are not signed in, and the link gives access to the gadget's source code. In a shared pool that is a data leak between customers, so it is the most important part of this feature.

**Independent Test**: Publish a blueprint as a member of organization A. As a member of A, view it, download it and create a gadget from it. As a member of B, as a signed-out visitor, and as an A member signed in to a different organization, try every one of those with the same link and the same blueprint id, and confirm every attempt is refused as if the blueprint did not exist.

**Acceptance Scenarios**:

1. **Given** a blueprint published in organization A, **When** a member of A opens its link, **Then** they see its details and can create a gadget from it.
2. **Given** the same link, **When** a member of organization B opens it, **Then** it is shown as not found, with nothing about it disclosed.
3. **Given** the same link, **When** a signed-out visitor opens it, **Then** they are asked to sign in, and after signing in as a non-member they get "not found".
4. **Given** the same blueprint id, **When** anyone outside A tries to download it, view its preview image, or create a gadget from it, **Then** each is refused as not found.
5. **Given** a gadget made from the blueprint, **When** a later release is published, **Then** members of A are offered the update; nobody outside A can see it or take it.
6. **Given** a member who published a blueprint and then left the organization, **When** other members use it, **Then** it remains available to the organization.

---

### User Story 4 - The shared catalog stays shared (Priority: P2)

The curated starter blueprints that ship with the product remain available to every organization and personal workspace, exactly as today. Only the operator curates them. An organization's own blueprint can never become part of that shared catalog.

**Why this priority**: The shared catalog is how new users get started, and it was an explicit decision to keep it. It must not be broken by isolating the rest, and it must not become a back door for one tenant's blueprint to reach everyone.

**Independent Test**: As members of two organizations, list and use a catalog blueprint and confirm both can; try to feature an organization's blueprint in the catalog and confirm it is refused.

**Acceptance Scenarios**:

1. **Given** the deployment's bundled blueprints, **When** any signed-in user in any tenant lists or uses them, **Then** they are available.
2. **Given** a blueprint published by an organization, **When** anyone tries to feature it in the shared catalog, **Then** it is refused.
3. **Given** a gadget made from a catalog blueprint, **When** the operator updates that blueprint, **Then** the gadget's owners can take the update as before.

---

### User Story 5 - Existing deployments and data are handled safely (Priority: P2)

Deployments that do not use organizations behave exactly as before. In a deployment that does, blueprints that were published before this feature are attributed to the tenant of the person who published them and become private to it from the moment the feature is enabled, rather than staying open to everyone.

**Why this priority**: Without this, turning the feature on would either leave old links open or break them for the people who made them.

**Independent Test**: In a deployment without organizations, confirm blueprint links work for everyone as before. In one with organizations and a blueprint published beforehand, confirm only the publisher's tenant can reach it afterwards.

**Acceptance Scenarios**:

1. **Given** a deployment with no tenants, **When** blueprints are shared by link, **Then** behaviour is unchanged for everyone.
2. **Given** a blueprint published before this feature by a member of organization A, **When** the feature is on, **Then** it is private to A.
3. **Given** a gadget that was already created from another tenant's blueprint before this feature, **When** the feature is on, **Then** the gadget keeps working but can no longer take updates from that blueprint, and says why.

---

### User Story 6 - An operator can inspect and reset an organization's branding (Priority: P3)

If an organization sets something unacceptable (an offensive name or logo, a misleading identity), the deployment operator can clear that organization's branding so it falls back to the deployment's, and can see which organizations have branding set.

**Why this priority**: Branding is shown to many people under the operator's product; the operator needs a safety valve. It is rarely used, so it ranks below the main flows.

**Independent Test**: Set branding for an organization, clear it as an operator, and confirm members see the deployment's branding; confirm a non-operator cannot do this.

**Acceptance Scenarios**:

1. **Given** an organization with branding, **When** an operator clears it, **Then** members see the deployment's branding and the administrator can set it again.
2. **Given** an operator, **When** they list organizations with branding, **Then** they see which have it set and when it last changed.
3. **Given** anyone who is not an operator, **When** they try either, **Then** it is refused.

---

### Edge Cases

- An organization is deleted: its branding is deleted with it, together with its blueprints (see spec 001, organization deletion).
- A user belongs to several organizations: branding always follows the workspace currently open, and a switch never leaves the previous organization's name, logo or color on screen.
- A logo or name is changed while members are using the product: they see the new branding on their next load at the latest, and never a mixture.
- A name or color is crafted to inject markup or styles: it is shown as plain text and a plain color value only; nothing is interpreted.
- A very large or malformed image is uploaded as a logo, or an image that is not a supported type: it is refused; the previous logo stays.
- A blueprint's preview image is requested directly by address, without any page: it must be refused outside the owning tenant just like the blueprint itself, even though such requests carry no sign-in today.
- A blueprint id that does not exist and one that exists in another tenant: the responses are indistinguishable, so existence is not disclosed.
- A signed-in user with no tenant (an account that predates organizations): treated as the legacy tenant, whose blueprints stay visible to the legacy tenant only.
- A member leaves an organization or is removed: blueprints they published stay with the organization; reassigning ownership is out of scope.
- A blueprint is exported to a file and imported into another deployment: allowed for people who can see it, and the imported copy belongs to the importer's tenant there.
- Two administrators save conflicting branding at the same moment: the last save wins and no partial mixture is stored.
- The operator disables per-tenant branding for the deployment: every organization falls back to the deployment's branding without losing what it saved.

## Requirements *(mandatory)*

### Functional Requirements

**Tenant branding**

- **FR-001**: The system MUST let each organization have branding made of three optional parts: a display name, a logo and an accent color.
- **FR-002**: Once a user is working in an organization's workspace, the system MUST show that organization's branding wherever the product shows the deployment's name, logo or accent color, including the browser tab title and icon.
- **FR-003**: The system MUST show the deployment's branding in personal workspaces, to organizations with no branding, and for any part an organization has not set.
- **FR-004**: The sign-in and sign-up pages, which are shown before any tenant is known, MUST show the deployment's branding.
- **FR-005**: Branding MUST follow the active workspace: switching workspace MUST replace it entirely and MUST NOT leave any of the previous workspace's branding visible.
- **FR-006**: Only an administrator of the organization MUST be able to set, change or clear that organization's branding. The role MUST be read from the verified session, never from what the client claims.
- **FR-007**: The system MUST validate branding on save: names within a length limit and shown as plain text, logos limited to accepted image types and a maximum size (the same as the deployment's own logo), and colors limited to valid color values. A refused save MUST say what is wrong and MUST keep the previous branding.
- **FR-008**: The system MUST let an organization administrator preview branding before saving and clear each part separately.
- **FR-009**: Branding MUST be scoped to its organization: one organization's administrator, member or request MUST NOT be able to read, change or infer another organization's branding.
- **FR-010**: Branding MUST NOT include banners or announcements, and MUST NOT change any other deployment setting. Those remain deployment-wide and operator-only.
- **FR-011**: The operator MUST be able to list organizations that have branding, see when each last changed, and clear any organization's branding. Nobody else MUST be able to.
- **FR-012**: The operator MUST be able to turn per-tenant branding off for the deployment, in which case everyone sees the deployment's branding and nothing saved is lost.
- **FR-013**: An organization's branding MUST be deleted when the organization is deleted.

**Blueprint isolation**

- **FR-014**: A blueprint published in a tenant MUST belong to that tenant. Everything that exposes it, namely its details, its downloadable form, its preview image, creating a gadget from it, and its update proposals, MUST be limited to members of that tenant.
- **FR-015**: Every refusal to a non-member MUST be indistinguishable from the blueprint not existing, so the existence of another tenant's blueprint is never disclosed.
- **FR-016**: A signed-out visitor MUST NOT be able to see any tenant's blueprint details, download it or see its preview image. Opening its link MUST lead to sign-in, and after sign-in the same rules apply.
- **FR-017**: A blueprint's preview image MUST be protected by the same rule as the blueprint, including when it is requested directly by address.
- **FR-018**: Sharing a blueprint by link MUST keep working between members of the owning tenant.
- **FR-019**: The deployment's bundled (curated) blueprints MUST remain available to every signed-in user in every tenant, curated only by the operator.
- **FR-020**: A tenant's blueprint MUST NOT be featured in, or otherwise added to, the shared catalog.
- **FR-021**: A blueprint MUST stay with the organization when its publisher leaves it or is removed.
- **FR-022**: Blueprints published before this feature MUST be attributed to the publisher's tenant and become private to it when the feature is enabled.
- **FR-023**: A gadget created from a blueprint of a different tenant before this feature MUST keep working, MUST NOT be able to take updates from that blueprint, and MUST tell its owner why.
- **FR-024**: Importing a blueprint file MUST make the imported blueprint belong to the importer's tenant.
- **FR-025**: In deployments with no tenants, blueprint behaviour MUST be unchanged.

**Safety and observability**

- **FR-026**: The system MUST record, with tenant and user identifiers but never image contents or other secrets, every branding change and every refused cross-tenant blueprint access.

### Key Entities *(include if feature involves data)*

- **Tenant branding**: An organization's optional display name, logo and accent color, plus when and by whom it last changed. At most one per organization. Absent parts fall back to the deployment's.
- **Deployment branding**: The operator's own name, logo and accent color, shown to personal workspaces, signed-out visitors and any part an organization has not set.
- **Blueprint**: A shareable gadget design. Has a publisher and, now, an owning tenant. Private to that tenant unless it is a bundled blueprint.
- **Bundled blueprint**: A curated starter blueprint that ships with the deployment, belongs to no tenant, and is available to all.
- **Organization administrator**: A member whose organization role, as verified in their session, allows managing the organization.
- **Operator**: A deployment administrator named in deployment configuration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a test with at least two organizations and a personal workspace, 100% of screens and the browser tab show the active workspace's branding and none show another's, across 20 workspace switches.
- **SC-002**: An organization administrator can set a name, logo and color and see them applied for members in under 2 minutes, without help.
- **SC-003**: 100% of attempts by non-administrators to change branding, and by anyone to change another organization's branding, are refused with no change.
- **SC-004**: In a cross-tenant test over every way a blueprint is exposed (details, download, preview image, create gadget, update), 0 attempts by another tenant or a signed-out visitor succeed, and every refusal is identical to the response for a blueprint that does not exist.
- **SC-005**: Members of the owning tenant succeed at every one of those actions in 100% of attempts, including via a shared link.
- **SC-006**: 100% of bundled blueprints remain available to every tenant, and 0 tenant blueprints can be added to the shared catalog.
- **SC-007**: In a deployment without tenants, the existing blueprint and branding behaviour is unchanged in 100% of the existing checks.
- **SC-008**: After enabling the feature in a deployment that has blueprints published earlier, 0 of them remain reachable by a tenant other than their publisher's.

## Assumptions

- Per-tenant branding applies to organizations only. Personal workspaces use the deployment's branding, and a personal workspace has no one to administer branding for.
- Branding is the name, logo and accent color. Banners and announcements stay deployment-wide notices from the operator.
- Organization administrators set branding for their own organization; operators can clear anyone's. This extends, narrowly, the earlier decision that only operators use the deployment's admin panel, and is the one place organization roles gain a capability. The role is taken from the verified session.
- The sign-in pages show the deployment's branding. Per-organization sign-in addresses (so the sign-in page itself is branded) are out of scope.
- Public sharing of a blueprint across tenants is not offered; that was decided off in the design record. Tenants wanting to share outside their organization export and send a file.
- Reassigning ownership of blueprints or other content of a departed member is out of scope (see spec 001).
- Moving, copying or publishing a tenant blueprint into the shared catalog is out of scope; the catalog is the operator's bundled set.
- The branding screen is available only to administrators; no separate approval workflow exists before branding goes live.
- This feature only depends on tenants as defined in spec 001. It does not add quotas, org-level connector choices or org-shared context collections.
- Blueprints already shared by link outside the deployment (copied elsewhere, exported files) cannot be recalled; isolation applies from the moment the feature is enabled.
