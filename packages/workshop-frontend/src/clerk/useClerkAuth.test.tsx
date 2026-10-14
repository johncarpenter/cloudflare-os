// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import {
  AUTH_ERROR_CODES, createAuthError, type PublicApi, type WorkspaceInfo,
} from '@gadgets/workshop-shared/api'
import { useAuth } from '../useAuth'
import { ClerkBridgeContext, type ClerkBridge } from './clerkBridge'

vi.mock('../errorReporting', () => ({
  setReportedUserId: vi.fn<(reportedUserId: string | undefined) => void>(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const apiFor = (authenticateFromClerk: (token: string) => FakeSession) =>
    ({ authenticateFromClerk }) as unknown as RpcStub<PublicApi>

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

function bridge(overrides: Partial<ClerkBridge> = {}): ClerkBridge {
  return {
    isLoaded: true,
    isSignedIn: true,
    userId: 'user_1',
    orgId: null,
    getToken: vi.fn<ClerkBridge['getToken']>(async () => 'token-for-user_1'),
    signOut: vi.fn<ClerkBridge['signOut']>(async () => {}),
    switchOrganization: vi.fn<ClerkBridge['switchOrganization']>(async () => {}),
    openUserProfile: vi.fn<ClerkBridge['openUserProfile']>(),
    ...overrides,
  }
}

const personal: WorkspaceInfo = { tenantId: 'u_user_1', kind: 'personal', personalTenantId: 'u_user_1' }

type FakeSession = {
  whoami: () => Promise<unknown>
  renewSession: () => Promise<void>
  getWorkspaceInfo: () => Promise<WorkspaceInfo>
  rememberWorkspace: () => Promise<void>
  [Symbol.dispose]: () => void
}

function session(whoami: () => Promise<unknown> = async () => ({ type: 'user' })): FakeSession {
  return {
    whoami,
    renewSession: async () => {},
    getWorkspaceInfo: async () => personal,
    rememberWorkspace: async () => {},
    [Symbol.dispose]: vi.fn<() => void>(),
  }
}

describe('useAuth with Clerk', () => {
  const roots: Root[] = []
  const containers: HTMLDivElement[] = []

  afterEach(() => {
    act(() => roots.forEach(root => root.unmount()))
    roots.length = 0
    containers.forEach(container => container.remove())
    containers.length = 0
    sessionStorage.clear()
    localStorage.clear()
  })

  type Snapshot = Pick<ReturnType<typeof useAuth>, 'isAuthenticated' | 'isLoading' | 'error' | 'logout'>

  async function mount(publicApi: RpcStub<PublicApi>, initial: ClerkBridge) {
    const captured: { auth?: Snapshot } = {}
    function Consumer(): ReactNode {
      const { isAuthenticated, isLoading, error, logout } = useAuth(publicApi)
      useEffect(() => { captured.auth = { isAuthenticated, isLoading, error, logout } })
      return null
    }
    const container = document.createElement('div')
    document.body.append(container)
    containers.push(container)
    const root = createRoot(container)
    roots.push(root)
    const render = async (value: ClerkBridge) => {
      await act(async () => {
        root.render(
          <ClerkBridgeContext.Provider value={value}><Consumer /></ClerkBridgeContext.Provider>)
      })
      await settle()
    }
    await render(initial)
    return { auth: () => captured.auth!, render }
  }

  it('shows loading until Clerk has loaded, then authenticates with its token', async () => {
    const authenticateFromClerk = vi.fn<(token: string) => FakeSession>(() => session())
    const { auth, render } = await mount(
      apiFor(authenticateFromClerk), bridge({ isLoaded: false, isSignedIn: false, userId: undefined }))
    expect(auth().isLoading).toBe(true)
    expect(authenticateFromClerk).not.toHaveBeenCalled()

    await render(bridge())
    expect(authenticateFromClerk).toHaveBeenCalledWith('token-for-user_1')
    expect(auth().isAuthenticated).toBe(true)
    expect(auth().isLoading).toBe(false)
  })

  it('does not authenticate a signed-out visitor', async () => {
    const authenticateFromClerk = vi.fn<(token: string) => FakeSession>(() => session())
    const { auth } = await mount(
      apiFor(authenticateFromClerk), bridge({ isSignedIn: false, userId: null }))
    expect(authenticateFromClerk).not.toHaveBeenCalled()
    expect(auth().isAuthenticated).toBe(false)
    expect(auth().isLoading).toBe(false)
  })

  it('drops the previous workspace and reconnects when the active organization changes', async () => {
    const first = session()
    const second = session()
    const authenticateFromClerk = vi.fn<(token: string) => FakeSession>()
        .mockReturnValueOnce(first).mockReturnValueOnce(second)
    const { auth, render } = await mount(apiFor(authenticateFromClerk), bridge())

    await render(bridge({ orgId: 'org_a', getToken: vi.fn<ClerkBridge['getToken']>(async () => 'token-for-org_a') }))
    expect(first[Symbol.dispose]).toHaveBeenCalled()
    expect(authenticateFromClerk).toHaveBeenLastCalledWith('token-for-org_a')
    expect(auth().isAuthenticated).toBe(true)
  })

  it('falls back to the personal workspace when the organization refuses the session', async () => {
    const refused = session(async () => { throw createAuthError(AUTH_ERROR_CODES.sessionNotPermitted) })
    const clerk = bridge({ orgId: 'org_a' })
    await mount(apiFor(() => refused), clerk)
    expect(clerk.switchOrganization).toHaveBeenCalledWith(null)
  })

  it('reports a refusal in the personal workspace instead of looping', async () => {
    const refused = session(async () => { throw createAuthError(AUTH_ERROR_CODES.sessionNotPermitted) })
    const clerk = bridge()
    const { auth } = await mount(apiFor(() => refused), clerk)
    expect(clerk.switchOrganization).not.toHaveBeenCalled()
    expect(auth().isAuthenticated).toBe(false)
    expect(auth().error).toMatch(/not permitted/i)
  })

  it('signs out through Clerk and drops the connection', async () => {
    const live = session()
    const clerk = bridge()
    const { auth } = await mount(apiFor(() => live), clerk)
    await act(async () => { auth().logout() })
    expect(clerk.signOut).toHaveBeenCalled()
    expect(live[Symbol.dispose]).toHaveBeenCalled()
    expect(auth().isAuthenticated).toBe(false)
  })
})
