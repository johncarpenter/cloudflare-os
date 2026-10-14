# Cloudflare OS SaaS — Design & Handoff

Oct 13, 2026 · @John Carpenter

## How to use this doc

This is the running design record for turning a fork of [cloudflare/cloudflare-os](https://github.com/cloudflare/cloudflare-os) into a multi-tenant product. A coding agent should treat **Decided** items as requirements, **Proposed** items as the default to implement unless John overrides them, and **Open** items as blockers to raise before building the affected part.

| Label | Meaning for the coding agent |
| --- | --- |
| Decided | John has chosen this. Build it. |
| Proposed | Design recommendation, not yet confirmed. Build behind a seam so it can change. |
| Open | Needs a decision. Do not guess; ask. |

## Product

The product is a controlled AI environment where users bring their own data, manage it, and use AI to build on it. "Controlled" is the selling point: an agent can touch only the datasets and documents the user has introduced it to, and every action is logged.

- **Base:** a fork of Cloudflare OS (agent chat, sandboxed gadgets, blueprints, gatekeepers).
- **Core additions:** a data layer (file uploads, a data lake on Cloudflare Basin, a context lake on Cloudflare AI Search) exposed through first-party gatekeepers.
- **Commercial layer:** Clerk for identity and organizations, Clerk Billing on Stripe for plans.
- **Third-party gatekeepers** (Gmail, Drive, Slack and so on) are secondary. Their OAuth verification burden keeps them off the B2C launch path.

## Decisions log

Seven decisions are settled; the rest of this doc builds on them.

| Decision | Status | Detail |
| --- | --- | --- |
| Base platform | Decided | Fork Cloudflare OS v2. Expect heavy customization; upstream drift is accepted. |
| Identity | Decided | Clerk for sign-in, users and organizations (B2C and B2B). |
| Billing | Decided | Clerk Billing on Stripe. Plans and features live in the Clerk Dashboard, not Stripe. |
| Tenancy model | Decided | Free and Pro (1–5 users) run in one shared pool. Enterprise (more than 5 users, SSO, isolation) runs in an isolated silo deployment. |
| Free vs Pro split | Decided | Separated by usage quotas, not features. |
| Blueprint catalog | Decided | One curated, shared catalog maintained by us. Update semantics still open (see Blueprint catalog). |
| Data layer priority | Decided | First-party data gatekeepers (uploads, Basin, AI Search) are the core build. Third-party OAuth gatekeepers come later. |

## Tenancy architecture

**Proposed:** one codebase that resolves a tenant on every request. The pool reads the tenant from the Clerk session; a silo deployment pins it to one value in config. Silos are then a deployment exercise, not a second codebase.

### What the repo does today

- **User identity is keyed by email.** `UserDurableObject` is addressed by `idFromName(email)`, whether sign-in came from a password, Cloudflare Access, or an auth gatekeeper ([docs/oauth-signin.md](https://github.com/cloudflare/cloudflare-os/blob/main/docs/oauth-signin.md)).
- **Gatekeepers already namespace by a "sharing domain".** The context gatekeeper receives a `sharingDomain` prop (default `"default"`) and prefixes every Durable Object name with it via `domainName(domain, id)`. The code comment says this separates trusted deployments and is not a boundary against malicious peers.
- **Sharing has no tenant check.** A direct add looks up any user by username; a share link admits anyone who holds the key ([docs/sharing.md](https://github.com/cloudflare/cloudflare-os/blob/main/docs/sharing.md)).

### Changes to make tenant-aware

1. **Clerk sign-in.** Verify the Clerk session JWT in the router or backend. Derive `tenantId` from the active Clerk organization. A B2C user without an organization gets a personal tenant.
2. **User keys.** Address the user Durable Object by `tenantId + NUL + clerkUserId` instead of email. Email can change, and one email may appear in two tenants.
3. **Sharing domain = tenant.** Pass `sharingDomain = tenantId` per request when binding gatekeepers, instead of one value per deployment. In the pool this becomes a security boundary, so every gatekeeper must scope by it, not only the context gatekeeper.
4. **Sharing checks.** Direct add and share-link redemption must reject users from another tenant.
5. **Gatekeeper credentials.** Each gatekeeper's `UserAccount` storage must be keyed by tenant as well as user.
6. **Blueprint lookup.** Two scopes: the global curated catalog (read-only) and tenant-private blueprints.
7. **Silo mode.** A config flag (for example `TENANT_MODE=single`, `TENANT_ID=<org>`) pins the tenant and rejects sessions from any other Clerk organization.

### Constraints

- **Upgrade path.** A Pro tenant that grows past 5 users must move to a silo. Durable Object state does not move between deployments by itself, so tenant export and import is required. The same tool serves GDPR deletion and portability.
- **Fork maintenance.** Changes 2–6 touch workshop-backend and every gatekeeper. Keep them behind one `TenantContext` seam to limit rebase pain.

## Data gatekeepers

**Proposed:** two first-party gatekeepers carry the data layer. The context lake extends the repo's existing `gatekeeper-context`; the data lake is a new `gatekeeper-basin`. Both store each tenant's data in that tenant's own Cloudflare resources and report usage to a per-tenant meter.

&#91;embedded content: data layer · 2 gatekeepers, 1 meter, per-tenant storage\]

Agents never hold storage credentials: each gatekeeper resolves the tenant's own resources and reports usage before returning data.

### Why gatekeepers, not a separate MCP server

Gatekeepers already do what "controlled" requires. Per the repo's [write-gatekeeper skill](https://github.com/cloudflare/cloudflare-os/blob/main/.agents/skills/write-gatekeeper/SKILL.md), each one:

- exposes a typed, capability-scoped API to agents and gadgets over Cap'n Web,
- lets the user grant access at fine granularity (one collection, one table),
- logs every read via `authorizeObservation()` and holds every side effect in the approval queue via `submitAction()`,
- simulates pending actions so the agent keeps working while approvals wait,
- verifies observers when a gadget is shared.

An external MCP endpoint (for Claude, Cursor and similar) becomes a thin facade over the same sessions later. It is not a parallel access path.

### Context lake: extend `gatekeeper-context`

The existing context gatekeeper already provides collections, private and admin-managed public visibility, a library UI, git-backed collections, and observer verification, all scoped by `sharingDomain`. Its weak point is search: `ContextCollectionDurableObject.search()` is a linear keyword scan over document bodies stored in Durable Object SQLite.

1. **Search backend.** Replace the linear scan with Cloudflare AI Search. Keep the agent-facing `search()` signature so existing blueprints and the agent skill keep working.
2. **Document bodies.** Move bodies from Durable Object SQLite to R2 so large PDFs and Office files fit, and so AI Search can index them from R2.
3. **Upload and manage.** Add file upload (PDF, DOCX, Markdown, text) to the library UI, with delete, re-index and per-document status.
4. **Tenant isolation.** Cloudflare offers instance-per-tenant (stronger, recommended) or a shared instance with a folder filter on every query ([AI Search multitenancy](https://developers.cloudflare.com/ai-search/how-to/per-tenant-search/)). Instance-per-tenant uses the `ai_search_namespaces` binding to create and delete instances at runtime. AI Search caps instances per account, so a large free tier needs a limit increase or the shared-instance fallback.

### Data lake: new `gatekeeper-basin`

Basin is Cloudflare's Iceberg-based analytics platform (formerly Pipelines, R2 Data Catalog and R2 SQL). Three facts from the [Basin SQL docs](https://developers.cloudflare.com/basin-sql/query-data/) shape the design:

- **Queries are scoped to a bucket.** The query endpoint is `POST /accounts/{account}/basin-sql/query/{bucket}`, so a bucket is the natural isolation unit.
- **Basin SQL is read-only.** `INSERT`, `CREATE` and other DML are rejected ([limitations](https://developers.cloudflare.com/basin-sql/reference/limitations-best-practices/)). Joins and subqueries are supported. Uploads need a separate write path.
- **The query token is broad.** It needs R2 storage read/write plus catalog and SQL permissions, so it must never reach a gadget. The gatekeeper holds it.

**Proposed isolation:** one R2 bucket with Basin Catalog enabled per tenant, created lazily on first dataset. A query can then only ever see that tenant's warehouse. The alternative, one shared bucket with a namespace per tenant, would require parsing every SQL statement to block cross-namespace references, which fails open if the parser is wrong. Check the account's R2 bucket limit against expected tenant counts.

**Grants inside a tenant:** whole lake, one namespace, or one table. Table and namespace grants still need SQL parsing, because a statement can name any table in the bucket. The gatekeeper parses each query, rejects any reference outside the grant, and rejects queries it cannot parse (fail closed).

**Ingest (open):** three candidate write paths for uploaded CSV and Parquet:

1. **Basin Pipelines.** Parse the upload in a Worker and stream records into a per-tenant pipeline that sinks to an Iceberg table. Fully managed, but needs per-tenant stream, sink and pipeline provisioning.
2. **Container conversion.** Run a short-lived Cloudflare Container (for example DuckDB) that writes Iceberg tables through Basin Catalog's Iceberg REST interface. Most flexible; Iceberg write support in the chosen engine needs a spike.
3. **Parquet only.** Accept Parquet uploads and register them as tables. Least work, worst user experience.

### Approvals and logging

| Operation | Caller | Treatment |
| --- | --- | --- |
| Upload, delete, re-index via the library UI | Human user | Direct action, logged; not an agent action |
| Search, read a document, run a query, describe a table | Agent or gadget | Observation: `authorizeObservation()` |
| Create, append to, or delete a table or document | Agent or gadget | Action: `submitAction()`, applied on approval, simulated until then |

### Metering hooks

Every session call reports usage to a per-tenant usage Durable Object: bytes scanned per Basin SQL query (Basin SQL is priced on data scanned), AI Search queries, documents indexed, and stored bytes. Quota checks run before expensive calls; see Billing and metering.

### Session API (sketch, needs review)

The write-gatekeeper skill requires stopping for API review before implementation. This is a starting point, not an approved API.

```typescript
// gatekeeper-basin: one session per grant (lake, namespace, or table)
interface DatasetSession {
  /** Tables visible under this grant. */
  listTables(): Promise<{ name: string; rows: number; columns: number; updated: string }[]>;
  /** Column names and types for one table. */
  describe(table: string): Promise<{ columns: { name: string; type: string }[] }>;
  /** First rows of a table, for orientation. */
  preview(table: string, limit?: number): Promise<Record<string, unknown>[]>;
  /** Read-only SQL. Only tables under this grant may be referenced. */
  query(sql: string): Promise<{ rows: Record<string, unknown>[]; bytesScanned: number }>;
}
```

## Billing and metering

**Proposed:** Clerk decides which plan a tenant is on; our code enforces that plan's quotas. Free and Pro are flat plans with different quotas, so Clerk Billing's lack of confirmed metered billing does not block launch.

The repo already has a starting point. With `ENABLE_CLOUDFLARE_LIMITS`, each user gets a free daily allowance of LLM calls counted on their `UserDurableObject` (`consumeDailyLlmCall`), checked before every agent turn by `checkUsageAndBalance` ([docs/ai-gateway-billing.md](https://github.com/cloudflare/cloudflare-os/blob/main/docs/ai-gateway-billing.md)).

1. **Move the counter to the tenant.** A per-tenant usage Durable Object replaces the per-user daily counter, so a 5-person Pro team shares one quota.
2. **Add meters.** LLM calls or tokens, Basin bytes scanned, AI Search queries, documents indexed, and stored bytes.
3. **Read quotas from the plan.** Map Clerk plan features to quota values; refresh on Clerk billing webhooks (delivered through Svix).
4. **Hard stop at the cap.** Block the call with an upgrade prompt. Overage charges are out of scope unless metered billing is confirmed.
5. **Optional BYOK.** The existing flow already routes funded users through their own Cloudflare AI Gateway credits. Decide whether Pro keeps it.

| Meter | Free | Pro | Enterprise |
| --- | --- | --- | --- |
| LLM calls per day | Open | Open | Contract |
| Stored data (GB) | Open | Open | Contract |
| Basin data scanned per month (GB) | Open | Open | Contract |
| AI Search queries per month | Open | Open | Contract |
| Indexed documents | Open | Open | Contract |

## Blueprint catalog

**Proposed:** ship the curated catalog as the fork's bundled blueprints, and rely on the upstream update mechanism. Gadgets made from a catalog blueprint can take later releases as a reviewed merge, so the catalog does not decay in the field.

This corrects an earlier assumption that instantiation is a one-way copy. Per [docs/blueprints.md](https://github.com/cloudflare/cloudflare-os/blob/main/docs/blueprints.md):

- **Gadgets follow their blueprint.** Each gadget records `upstream = {blueprintId, commitId}`. When a newer release exists, the editor shows "Update available".
- **Updates are a three-way merge.** The user previews the update in a new chat, and an agent resolves conflicts. Nothing applies automatically.
- **Bundled blueprints are data in the repo.** `packages/bundled-blueprints/blueprints/` holds one directory per blueprint, and `BUNDLED_BLUEPRINTS_DIR` lets a fork ship its own set. New files reinstall on the next request and surface as updates.

What the fork still needs:

1. **Global scope in the pool.** Bundled blueprints install per deployment today. In the pool they must be readable by every tenant and writable only by us.
2. **Tenant-private publishing.** Blueprints a tenant publishes stay inside that tenant; public cross-tenant publishing is off.
3. **Ship source, not build output.** Upstream warns that bundled formats ship bundled `client.js` and `server.js`, which merge poorly. Catalog blueprints should ship source so customized gadgets update cleanly.
4. **Data-shaped starter set.** Dataset explorer, document Q&A over a collection, dashboard over a Basin table, report builder.

## Open questions

- [ ] **Data lake ingest path:** Basin Pipelines, container conversion, or Parquet only? Recommend a one-day spike on container conversion first.
- [ ] **AI Search isolation for Free:** instance per tenant everywhere, or a shared instance with folder filters for Free and instances for Pro?
- [ ] **Grant granularity:** offer table- and namespace-level grants (needs SQL parsing) at launch, or whole-lake grants only?
- [ ] **One user, many tenants:** can a Clerk user belong to several pooled tenants (switching organizations), or exactly one?
- [ ] **Quota values** for Free and Pro (Billing and metering table).
- [ ] **BYOK on Pro:** keep the upstream AI Gateway bring-your-own-credits flow?
- [ ] **Account limits:** confirm R2 bucket and AI Search instance limits per Cloudflare account against expected tenant counts; decide whether pools shard across accounts.
- [ ] **External MCP facade:** launch item or later phase? If launch, which OAuth issuer (Clerk or our own)?

## Work packages for the coding agent

Build in this order; each package lists what it waits on. Follow the repo's [write-gatekeeper skill](https://github.com/cloudflare/cloudflare-os/blob/main/.agents/skills/write-gatekeeper/SKILL.md) for any gatekeeper work, including its mandatory stop for API review.

1. **WP1 TenantContext seam.** Add a `TenantContext` resolved per request, plus `TENANT_MODE=single` for silos. No behaviour change in single mode. Waits on nothing.
2. **WP2 Clerk sign-in.** Verify Clerk session JWTs; map Clerk user and organization to a tenant-keyed user Durable Object. Waits on WP1 and the one-user-many-tenants answer.
3. **WP3 Tenant-scoped sharing and credentials.** Pass `sharingDomain = tenantId`; reject cross-tenant collaborator adds and share-link redemptions; key gatekeeper `UserAccount` storage by tenant. Waits on WP1.
4. **WP4 Usage meter.** Per-tenant usage Durable Object; move the daily LLM counter there; quota checks before agent turns. Waits on WP1.
5. **WP5 Context lake.** In `gatekeeper-context`: R2 document bodies, AI Search backend behind the existing `search()`, upload and re-index in the library UI, metering calls. Waits on WP3, WP4 and the AI Search isolation answer.
6. **WP6 `gatekeeper-basin` API proposal.** Draft `types.d.ts` from the sketch above, then stop for review. Waits on the grant-granularity answer.
7. **WP7 `gatekeeper-basin` implementation.** Per-tenant bucket provisioning, query proxy with SQL reference checks, approvals, simulation, observers, metering. Waits on WP6 approval and WP4.
8. **WP8 Ingest.** The chosen write path for CSV and Parquet uploads. Waits on the ingest decision.
9. **WP9 Clerk Billing.** Plans in Clerk, webhook handler that updates tenant quotas, upgrade prompts. Waits on WP4 and quota values.
10. **WP10 Catalog.** Global bundled-blueprint scope, tenant-private publishing, first data-shaped blueprints shipped as source. Waits on WP5 and WP7.
11. **WP11 Tenant export and import.** Needed for Pro-to-Enterprise moves and GDPR requests. Waits on WP3.
