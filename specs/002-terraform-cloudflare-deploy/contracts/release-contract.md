# Contract: what the module reads from a release

Produced by `node scripts/release/build-release.ts --out <dir>` (unchanged format, one addition).

```text
<dir>/manifest.json
<dir>/modules/<sha256>          worker module blobs
<dir>/assets/<cfHash>           static asset blobs
<dir>/asset-trees/<variant>/    written by `verify-release.ts --materialize` (not part of CI output)
```

## Used manifest fields

| Field | Used for |
|---|---|
| `releaseId` | output; deployment annotation |
| `workers.<pkg>.kind` | `backend`, `router`, `gatekeeper` selection |
| `workers.<pkg>.shortName`, `installable`, `preinstall` | gatekeeper install set and bindings |
| `workers.<pkg>.mainModule`, `modules[]` | upload parts and checksums |
| `workers.<pkg>.compatibilityDate/Flags`, `migrations`, `observability` | worker settings (observability overridable) |
| `workers.<pkg>.bindings[]`, `vars` | rendered bindings (closed placeholder set) |
| `workers.<pkg>.gatekeeperBindingExpansion` | `GATEKEEPER_*` entrypoint and props |
| `workers.<pkg>.inputs[]` | required secrets/vars for an enabled gatekeeper |
| `workers.router.assetsConfig` | `not_found_handling`, `run_worker_first`, variant selection |

## Change to the release (FR-012)

`assetsConfig.variants` gains `standard` beside `access`. `standard` is the same frontend built
without `VITE_CF_ACCESS_MODE`, which is the build that signs in through Clerk. Existing consumers
that read only `access` are unaffected.

## Failure messages

| Situation | Message |
|---|---|
| `manifest.json` missing | the release is incomplete or unfinished |
| `frontend_variant` absent | lists the variants present and says to rebuild with the current script |
| module blob missing or checksum differs | worker and file |
| asset blob missing or key differs | path |
