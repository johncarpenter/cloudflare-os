import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_ERROR_CODES, createAuthError, type WorkspaceInfo } from '@gadgets/workshop-shared/api'
import {
  RENEWAL_INTERVAL_MS, restoreOrRememberWorkspace, startSessionRenewal, WORKSPACE_RESTORED_KEY,
} from './clerkSession'

describe('startSessionRenewal', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('renews every interval with a freshly fetched token, and stops when asked', async () => {
    const renewSession = vi.fn<(token: string) => Promise<void>>(async () => {})
    const getToken = vi.fn<(options: { skipCache: boolean }) => Promise<string | null>>(async () => 'token')
    const stop = startSessionRenewal({ renewSession }, getToken, vi.fn<() => void>())

    await vi.advanceTimersByTimeAsync(RENEWAL_INTERVAL_MS * 2)
    expect(renewSession).toHaveBeenCalledTimes(2)
    expect(getToken).toHaveBeenCalledWith({ skipCache: true })

    stop()
    await vi.advanceTimersByTimeAsync(RENEWAL_INTERVAL_MS * 2)
    expect(renewSession).toHaveBeenCalledTimes(2)
  })

  it('reports a refusal by the server, but leaves transport failures to the reconnect', async () => {
    const onRefused = vi.fn<() => void>()
    const renewSession = vi.fn<(token: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error('socket closed'))
        .mockRejectedValueOnce(createAuthError(AUTH_ERROR_CODES.sessionNotPermitted))
    startSessionRenewal({ renewSession }, async () => 'token', onRefused)

    await vi.advanceTimersByTimeAsync(RENEWAL_INTERVAL_MS)
    expect(onRefused).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(RENEWAL_INTERVAL_MS)
    expect(onRefused).toHaveBeenCalledTimes(1)
  })

  it('treats a Clerk session that has gone as a refusal without calling the server', async () => {
    const onRefused = vi.fn<() => void>()
    const renewSession = vi.fn<(token: string) => Promise<void>>(async () => {})
    startSessionRenewal({ renewSession }, async () => null, onRefused)

    await vi.advanceTimersByTimeAsync(RENEWAL_INTERVAL_MS)
    expect(onRefused).toHaveBeenCalledTimes(1)
    expect(renewSession).not.toHaveBeenCalled()
  })
})

const info = (overrides: Partial<WorkspaceInfo>): WorkspaceInfo => ({
  tenantId: 'u_me', kind: 'personal', personalTenantId: 'u_me', ...overrides,
})
const memoryStorage = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null,
           setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('restoreOrRememberWorkspace', () => {

  it('switches to the organization last used elsewhere, once, without remembering yet', async () => {
    const rememberWorkspace = vi.fn<() => Promise<void>>(async () => {})
    const switchOrganization = vi.fn<(organizationId: string | null) => Promise<void>>(async () => {})
    const api = {
      getWorkspaceInfo: async () => info({ lastWorkspaceId: 'org_a' }), rememberWorkspace,
    }
    const storage = memoryStorage()

    await restoreOrRememberWorkspace(api, switchOrganization, storage)
    expect(switchOrganization).toHaveBeenCalledWith('org_a')
    expect(rememberWorkspace).not.toHaveBeenCalled()
    expect(storage.getItem(WORKSPACE_RESTORED_KEY)).not.toBeNull()

    // Back in the same browser session (after the switch re-authenticated): remember instead.
    await restoreOrRememberWorkspace(api, switchOrganization, storage)
    expect(switchOrganization).toHaveBeenCalledTimes(1)
    expect(rememberWorkspace).toHaveBeenCalledTimes(1)
  })

  it('returns to the personal workspace when that was the last one used', async () => {
    const switchOrganization = vi.fn<(organizationId: string | null) => Promise<void>>(async () => {})
    await restoreOrRememberWorkspace({
      getWorkspaceInfo: async () => info({
        tenantId: 'org_a', kind: 'organization', lastWorkspaceId: 'u_me',
      }),
      rememberWorkspace: async () => {},
    }, switchOrganization, memoryStorage())
    expect(switchOrganization).toHaveBeenCalledWith(null)
  })

  it('stays put and remembers the current workspace when the last one cannot be opened', async () => {
    const rememberWorkspace = vi.fn<() => Promise<void>>(async () => {})
    await restoreOrRememberWorkspace(
      { getWorkspaceInfo: async () => info({ lastWorkspaceId: 'org_gone' }), rememberWorkspace },
      async () => { throw new Error('not a member') },
      memoryStorage())
    expect(rememberWorkspace).toHaveBeenCalledTimes(1)
  })

  it('does not switch when already in the last-used workspace', async () => {
    const switchOrganization = vi.fn<(organizationId: string | null) => Promise<void>>(async () => {})
    const rememberWorkspace = vi.fn<() => Promise<void>>(async () => {})
    await restoreOrRememberWorkspace(
      { getWorkspaceInfo: async () => info({ lastWorkspaceId: 'u_me' }), rememberWorkspace },
      switchOrganization, memoryStorage())
    expect(switchOrganization).not.toHaveBeenCalled()
    expect(rememberWorkspace).toHaveBeenCalledTimes(1)
  })
})
