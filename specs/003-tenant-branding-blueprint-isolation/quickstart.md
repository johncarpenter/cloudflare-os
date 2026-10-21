# Quickstart: validating tenant branding and blueprint isolation

Steps marked **(live)** need a Clerk instance with two organizations.

## Automated

```sh
cd packages/workshop-backend
pnpm exec vitest run                                              # unit: blueprint-access, tenant-branding, validation
pnpm exec vitest run --config vitest.integration.config.ts        # two tenants over real RPC
cd ../workshop-frontend
NODE_OPTIONS=--localstorage-file=/tmp/ls.json pnpm exec vitest run --no-file-parallelism
cd ../.. && pnpm run lint:check && pnpm run build
```

The integration suite is expected to cover, for tenants A and B and a signed-out visitor:

- **Blueprint**: A publishes; A views, downloads, previews, makes a gadget, takes an update; B and the
  visitor get "not found" on every one, with responses equal to a random id's; bundled blueprints work for
  both; featuring or promoting A's blueprint is refused; a pre-feature record is owner-only, then
  attributed by the sweep; a departed publisher's blueprint stays with A.
- **Branding**: A's admin sets, clears each part, previews; a member and an operator-who-is-not-an-admin
  cannot write; B never sees A's branding; invalid name, color and logo are refused and change nothing; a
  role removed at the next renewal refuses writes; organization deletion removes it; the operator can
  list, clear and switch it off without losing data.

## Manual (live)

1. Sign in as an admin of organization A: open **Branding**, set a name, upload a PNG, pick a color; see
   the preview; save. Reload: the header, sidebar, tab title and icon use it.
2. Sign in as a non-admin member of A: same branding, no Branding page.
3. Switch to organization B, then to your personal workspace: branding follows each time and never mixes.
4. As an A member, publish a blueprint and open its link as a B member, then in a private window:
   "not found" (signed in) and "sign in to continue" (signed out); the same link works for an A member.
5. As an operator, open **Admin → Tenant branding**: list, clear one, switch the feature off and on.
6. Open a bundled blueprint as members of A and B: both can use it.
