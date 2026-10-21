# Contract: blueprint access

Applies only when Clerk is enabled. Caller = `{ tenantId, userDoId }` from the verified session, or
`undefined` for unauthenticated requests.

```ts
// packages/workshop-backend/src/blueprint-access.ts
/** The record, or undefined: a blueprint the caller may not read looks exactly like a missing one. */
readBlueprintFor(env, id, caller): Promise<BlueprintKvRecord | undefined>
```

## Matrix

| Surface | Bundled | Own tenant | Other tenant | Unattributed (legacy) | Unauthenticated |
|---|---|---|---|---|---|
| `PublicApi.getBlueprint` / `downloadBlueprint` | allowed | not found | not found | not found | bundled only |
| `GET /blueprint-screenshot/<id>` | served (public cache) | 404 | 404 | 404 | bundled only |
| `AuthenticatedApi.getBlueprint` / `downloadBlueprint` | allowed | allowed | not found | owner only | n/a |
| `AuthenticatedApi.getBlueprintScreenshot` | allowed | allowed | null | owner only | n/a |
| `newGadgetFromBlueprint` | allowed | allowed | "Blueprint not found." | owner only | n/a |
| `Overseer.applyBlueprint` / `initializeFromBlueprint` / `fetchBlueprint` | allowed | allowed | not found | owner only | n/a |
| `addBlueprintToLibrary` | allowed | allowed | not found | owner only | n/a |
| `promoteFormat`, featuring (operator) | allowed | **refused** | **refused** | **refused** | n/a |
| publish / import | n/a | records `tenantId` | n/a | n/a | n/a |

"Not found" means the same response as for an id that does not exist: same error text, same shape,
no timing-visible extra work beyond the single KV read both cases already make.

## Rules

- Role does not matter: any member of the owning tenant may read, download and make gadgets from it; only
  the publisher updates or deletes it (unchanged).
- A blueprint stays with its tenant when its publisher leaves; nobody else gains access.
- Listing never includes a blueprint the caller may not read (`listFeaturedBlueprints` contains
  bundled/featured only; the library lists what the user added).
- The backfill sweep sets `tenantId` on unattributed records and removes tenant-owned entries from the
  featured list; it is idempotent and safe to re-run.
- Audit: a refused authenticated read logs `blueprint.access.refused` with caller tenant and user
  (never the blueprint's contents).
