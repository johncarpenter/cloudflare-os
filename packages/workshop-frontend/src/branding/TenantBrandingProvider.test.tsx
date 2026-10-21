// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, EffectiveBranding, ServerConfig } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../AuthContext'
import { applyAccentColor } from '../theme'
import { ServerConfigContext, useServerConfig } from '../ServerConfigContext'
import TenantBrandingProvider from './TenantBrandingProvider'
import { useTenantBranding } from './useTenantBranding'

vi.mock('../AuthContext', () => ({ useAuthenticatedApi: vi.fn<typeof useAuthenticatedApi>() }))
vi.mock('../theme', () => ({ applyAccentColor: vi.fn<typeof applyAccentColor>() }))
vi.mock('../siteLogoUtils', () => ({ applySiteFavicon: () => () => {} }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DEPLOYMENT = { siteName: 'Deployment', accentColor: '' } as unknown as ServerConfig

function api(
  getBranding: () => Promise<EffectiveBranding | null>,
  canManage = false,
): RpcStub<AuthenticatedApi> {
  return {
    getBranding,
    getTenantAdminApi: async () => (canManage ? { [Symbol.dispose]: () => {} } : null),
  } as unknown as RpcStub<AuthenticatedApi>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('TenantBrandingProvider', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.restoreAllMocks()
  })

  function mount(initial: RpcStub<AuthenticatedApi>) {
    let current = initial
    let seen: { config: ServerConfig | null; manage: boolean } | undefined
    vi.mocked(useAuthenticatedApi).mockImplementation(
      () => ({ authenticatedApi: current }) as ReturnType<typeof useAuthenticatedApi>)
    function Probe() {
      seen = { config: useServerConfig(), manage: useTenantBranding().canManage }
      return null
    }
    // A new element each time, or React skips the re-render that a switch needs.
    const tree = () => (
      <ServerConfigContext.Provider value={DEPLOYMENT}>
        <TenantBrandingProvider><Probe /></TenantBrandingProvider>
      </ServerConfigContext.Provider>
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    return {
      render: () => act(async () => root!.render(tree())),
      switchTo: (next: RpcStub<AuthenticatedApi>) => { current = next },
      seen: () => seen!,
    }
  }

  it('shows the deployment branding until the organization\'s arrives, then the organization\'s', async () => {
    const pending = deferred<EffectiveBranding | null>()
    const app = mount(api(() => pending.promise))
    await app.render()
    expect(app.seen().config?.siteName).toBe('Deployment')

    await act(async () => { pending.resolve({ siteName: 'Acme', accentColor: '#abcdef' }) })
    expect(app.seen().config?.siteName).toBe('Acme')
    expect(applyAccentColor).toHaveBeenLastCalledWith('#abcdef')
  })

  it('shows nothing of the previous organization after a switch, even while the next loads', async () => {
    const next = deferred<EffectiveBranding | null>()
    const app = mount(api(async () => ({ siteName: 'Acme' })))
    await app.render()
    expect(app.seen().config?.siteName).toBe('Acme')

    app.switchTo(api(() => next.promise))
    await app.render()
    expect(app.seen().config?.siteName).toBe('Deployment')

    await act(async () => { next.resolve({ siteName: 'Globex' }) })
    expect(app.seen().config?.siteName).toBe('Globex')
  })

  it('keeps the deployment branding when the organization has none or the read fails', async () => {
    const none = mount(api(async () => null))
    await none.render()
    expect(none.seen().config).toBe(DEPLOYMENT)

    act(() => root!.unmount())
    container!.remove()
    const failing = mount(api(async () => { throw new Error('offline') }))
    await failing.render()
    expect(failing.seen().config).toBe(DEPLOYMENT)
  })

  it('reports whether the session may manage the branding', async () => {
    const admin = mount(api(async () => null, true))
    await admin.render()
    expect(admin.seen().manage).toBe(true)

    act(() => root!.unmount())
    container!.remove()
    const member = mount(api(async () => null, false))
    await member.render()
    expect(member.seen().manage).toBe(false)
  })
})
