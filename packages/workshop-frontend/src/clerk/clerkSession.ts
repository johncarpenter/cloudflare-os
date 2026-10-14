import { getAuthErrorCode, type WorkspaceInfo } from '@gadgets/workshop-shared/api'

/**
 * How often the server session is renewed. The server closes a connection that goes 75 seconds
 * without a renewal, and a Clerk token lives 60 seconds, so every 30 keeps one missed beat harmless
 * and makes a removed member lose access within about a minute.
 */
export const RENEWAL_INTERVAL_MS = 30_000

/** Set once the last-used workspace has been considered in this browser session. */
export const WORKSPACE_RESTORED_KEY = 'clerkWorkspaceRestored'

/**
 * Renews the server session with a freshly fetched token on a timer. `onRefused` runs when the
 * server refuses the session (membership ended, other tenant, lapsed) or Clerk no longer has a
 * session; transport failures are left to the connection's own reconnect. Returns a stop function.
 */
export function startSessionRenewal(
    api: { renewSession: (sessionToken: string) => Promise<void> },
    getToken: (options: { skipCache: boolean }) => Promise<string | null>,
    onRefused: () => void): () => void {
  let stopped = false
  let inFlight = false
  const timer = setInterval(async () => {
    if (inFlight) return
    inFlight = true
    try {
      const token = await getToken({ skipCache: true })
      if (stopped) return
      if (!token) {
        onRefused()
        return
      }
      await api.renewSession(token)
    } catch (error) {
      if (!stopped && getAuthErrorCode(error) !== undefined) onRefused()
    } finally {
      inFlight = false
    }
  }, RENEWAL_INTERVAL_MS)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

/**
 * Once per browser session, opens the workspace the user last used on any device; every other time,
 * and when that workspace can't be opened (the membership is gone), remembers the current one. A
 * successful switch changes the active organization, which makes the app re-authenticate into it.
 */
export async function restoreOrRememberWorkspace(
    api: { getWorkspaceInfo: () => Promise<WorkspaceInfo>; rememberWorkspace: () => Promise<void> },
    switchOrganization: (organizationId: string | null) => Promise<void>,
    storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage): Promise<void> {
  const info = await api.getWorkspaceInfo()
  if (storage.getItem(WORKSPACE_RESTORED_KEY) === null) {
    storage.setItem(WORKSPACE_RESTORED_KEY, '1')
    const last = info.lastWorkspaceId
    if (last !== undefined && last !== info.tenantId) {
      try {
        await switchOrganization(last === info.personalTenantId ? null : last)
        return
      } catch {
        // The membership is gone; stay where we are and remember it.
      }
    }
  }
  await api.rememberWorkspace()
}
