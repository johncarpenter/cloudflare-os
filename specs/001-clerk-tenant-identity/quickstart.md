# Quickstart: validating Clerk sign-in and tenancy

Prerequisites: a Clerk development instance (see [configuration](./contracts/configuration.md)),
pnpm, and the repo built (`pnpm install`).

## Automated

```sh
pnpm exec vp run -F @gadgets/workshop-backend test:run      # tenant, clerk auth, webhook, sharing tests
pnpm exec vp run -F @gadgets/workshop-frontend test:run     # Clerk gate/renewal tests
pnpm lint
```

(Use the exact task invocation from `docs/testing.md` if it differs.)

## Manual end-to-end

1. Set `CLERK_ISSUER`, `CLERK_PUBLISHABLE_KEY`, `CLERK_AUTHORIZED_PARTIES=http://localhost:3000`,
   `ADMINS=["<your clerk user id>"]` in the backend `.env`; run `pnpm dev-server`.
2. **Story 1**: open the app signed out → Clerk sign-in is shown, no workspace data. Sign up → empty
   personal workspace. Create a gadget, sign out/in → it is there. Change your email in Clerk → same
   workspace.
3. **Story 2**: create an organization in the switcher → empty org workspace. Invite a second
   account; accept; that user sees the org workspace and not yours.
4. **Story 4**: share a gadget with a member (works); try the share link from a user in another
   organization (refused); search shows only the same tenant's users.
5. **Removal**: remove the member in Clerk → their open Workshop returns to sign-in/personal within
   60 s.
6. **Story 3**: set `TENANT_MODE=single`, `TENANT_ID=<org id>` → members sign in; others are refused.
7. **Story 5**: switch workspaces, edit profile, sign out from the header.
8. **Admin**: only a user id listed in `ADMINS` sees the Admin menu item, regardless of org role.
9. **Regression**: unset `CLERK_ISSUER` → the original password/Access login works unchanged.
