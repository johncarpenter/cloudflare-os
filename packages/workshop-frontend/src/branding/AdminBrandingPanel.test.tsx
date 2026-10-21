// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AdminApi, TenantBrandingSummary } from '@gadgets/workshop-shared/api'
import AdminBrandingPanel from './AdminBrandingPanel'

const testState = vi.hoisted(() => ({ addToast: vi.fn<(toast: { title: string; variant: string }) => void>() }))

vi.mock('@cloudflare/kumo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudflare/kumo')>()),
  useKumoToastManager: () => ({ add: testState.addToast }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ORGS: TenantBrandingSummary[] = [
  { tenantId: 'org_a', updatedAt: new Date('2026-01-02') },
  { tenantId: 'org_b', updatedAt: new Date('2026-01-01') },
]

describe('AdminBrandingPanel', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.clearAllMocks()
  })

  function setup(list: TenantBrandingSummary[]) {
    let current = list
    const admin = {
      listTenantBranding: vi.fn<() => Promise<TenantBrandingSummary[]>>(async () => current),
      clearTenantBranding: vi.fn<(id: string) => Promise<void>>(async (id) => {
        current = current.filter((org) => org.tenantId !== id)
      }),
      setTenantBrandingEnabled: vi.fn<(enabled: boolean) => Promise<void>>(async () => {}),
    }
    const onEnabledChange = vi.fn<(enabled: boolean) => void>()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    return {
      admin, onEnabledChange,
      render: (enabled = true) => act(async () => root!.render(
        <AdminBrandingPanel
          admin={admin as unknown as RpcStub<AdminApi>}
          enabled={enabled}
          onEnabledChange={onEnabledChange}
        />)),
    }
  }

  const button = (label: string) =>
    [...container!.querySelectorAll('button')].find((b) => b.textContent === label)!

  it('lists the organizations with branding, and says when there are none', async () => {
    const some = setup(ORGS)
    await some.render()
    expect(container!.textContent).toContain('org_a')
    expect(container!.textContent).toContain('org_b')

    act(() => root!.unmount())
    container!.remove()
    const none = setup([])
    await none.render()
    expect(container!.textContent).toContain('No organization has set branding')
  })

  it('clears one organization and lists the rest', async () => {
    const panel = setup(ORGS)
    await panel.render()
    await act(async () => button('Clear branding').click())
    expect(panel.admin.clearTenantBranding).toHaveBeenCalledWith('org_a')
    expect(container!.textContent).not.toContain('org_a')
    expect(container!.textContent).toContain('org_b')
  })

  it('reports the new setting only after the server accepted it', async () => {
    const panel = setup([])
    await panel.render(true)
    // The checkbox the switch forwards its clicks to: jsdom has no PointerEvent, which the switch
    // forwards them with.
    const toggle = container!.querySelector<HTMLElement>('[aria-label="Allow organization branding"]')!
        .nextElementSibling as HTMLInputElement
    await act(async () => toggle.click())
    expect(panel.admin.setTenantBrandingEnabled).toHaveBeenCalledWith(false)
    expect(panel.onEnabledChange).toHaveBeenCalledWith(false)

    panel.admin.setTenantBrandingEnabled.mockRejectedValueOnce(new Error('Not permitted'))
    panel.onEnabledChange.mockClear()
    await act(async () => toggle.click())
    expect(panel.onEnabledChange).not.toHaveBeenCalled()
    expect(testState.addToast).toHaveBeenCalledWith({ title: 'Not permitted', variant: 'error' })
  })
})
