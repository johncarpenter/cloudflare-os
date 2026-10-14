# Contract: Workshop RPC additions (`packages/workshop-shared/src/api.ts`)

All additions are doc-commented in source (constitution I). Signatures:

```typescript
// PublicApi
/** Authenticate with a Clerk session token. Throws a coded auth error if Clerk sign-in is not
 *  enabled, the token is invalid, belongs to a different tenant than this (single-tenant)
 *  deployment, or the user is no longer a member of the token's organization. */
authenticateFromClerk(sessionToken: string): Promise<AuthenticatedApi>;

// AuthenticatedApi
/** Present a fresh Clerk session token to keep this connection alive. The token must be for the
 *  same user and tenant; otherwise the connection is refused and closed. Call at least every 30s. */
renewSession(sessionToken: string): Promise<void>;

/** The caller's active tenant and last remembered workspace (see rememberWorkspace). */
getWorkspaceInfo(): Promise<WorkspaceInfo>;

/** Remember the active tenant as this user's last-used workspace, across devices. */
rememberWorkspace(): Promise<void>;

// Types
type WorkspaceInfo = {
  tenantId: string;
  kind: "organization" | "personal";
  /** The user's personal tenant id, to recognise it in lastWorkspaceId. */
  personalTenantId: string;
  /** The tenant last remembered by `rememberWorkspace`, if any. */
  lastWorkspaceId?: string;
};

type ClerkClientConfig = { publishableKey: string };
// ServerConfig.clerk?: ClerkClientConfig   (present iff Clerk sign-in is enabled)

// AUTH_ERROR_CODES additions
sessionNotPermitted: "SESSION_NOT_PERMITTED"   // wrong tenant / membership ended / sign-in disabled
sessionExpired:      "SESSION_EXPIRED"         // renewal lapsed
```

## Behavioural guarantees

- `authenticateFromClerk` never creates state for a refused session.
- The tenant is taken only from the verified token. No client argument names a tenant.
- Refusal messages never say whether a user or invitation exists in another tenant.
- On a Clerk-enabled deployment `login`, `createAccount`, `authenticate`, `startGatekeeperLogin`,
  `authenticateFromCfAccess` and `beginDeviceSessionHandoff` throw a coded error.
- `UserDirectoryRecord.id` for Clerk users is the user key (`tenant NUL user`); clients treat ids as
  opaque and display `name`.
