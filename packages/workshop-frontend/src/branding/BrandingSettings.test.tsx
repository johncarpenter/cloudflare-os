// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, TenantAdminApi, TenantBranding } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../AuthContext'
import BrandingSettings from './BrandingSettings'

const testState = vi.hoisted(() => ({ addToast: vi.fn<(toast: { title: string; variant: string }) => void>() }))

vi.mock('../AuthContext', () => ({ useAuthenticatedApi: vi.fn<typeof useAuthenticatedApi>() }))
vi.mock('../useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('@cloudflare/kumo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudflare/kumo')>()),
  useKumoToastManager: () => ({ add: testState.addToast }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('BrandingSettings', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.clearAllMocks()
  })

  function manage(saved: TenantBranding) {
    return {
      getBranding: vi.fn<() => Promise<TenantBranding>>(async () => saved),
      setIdentity: vi.fn<TenantAdminApi['setIdentity']>(async () => {}),
      setLogo: vi.fn<TenantAdminApi['setLogo']>(async () => {}),
      [Symbol.dispose]: vi.fn<() => void>(),
    }
  }

  async function open(capability: ReturnType<typeof manage> | null) {
    // One stub for the whole session: a new one per render would restart the page's effect.
    const authenticatedApi = { getTenantAdminApi: async () => capability } as unknown as RpcStub<AuthenticatedApi>
    vi.mocked(useAuthenticatedApi).mockImplementation(
      () => ({ authenticatedApi }) as ReturnType<typeof useAuthenticatedApi>)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<BrandingSettings />))
  }

  function type(label: string, value: string) {
    const input = container!.querySelector<HTMLInputElement>(
      label === 'Name' ? 'input[placeholder="Cloudflare OS"]' : `input[aria-label="${label}"]`)!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const saveButton = () =>
    [...container!.querySelectorAll('button')].find((button) => button.textContent === 'Save')!

  it('tells someone who cannot manage branding that they cannot, and shows no controls', async () => {
    await open(null)
    expect(container!.textContent).toContain('Only organization administrators')
    expect(container!.querySelector('input')).toBeNull()
  })

  it('saves the trimmed name and the color, and clears a part left empty', async () => {
    const capability = manage({ name: 'Acme', accentColor: '#112233' })
    await open(capability)
    expect(saveButton().disabled).toBe(true)

    type('Accent color value', '')
    type('Name', '  Acme Corp ')
    await act(async () => saveButton().click())

    expect(capability.setIdentity).toHaveBeenCalledWith({ name: 'Acme Corp', accentColor: null })
    expect(testState.addToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
  })

  it('refuses a name that is too long and a color that is not hex, without calling the server', async () => {
    const capability = manage({})
    await open(capability)

    type('Name', 'a'.repeat(41))
    expect(container!.textContent).toContain('at most 40 characters')
    expect(saveButton().disabled).toBe(true)

    type('Name', 'Acme')
    type('Accent color value', 'red')
    expect(container!.textContent).toContain('hex color')
    expect(saveButton().disabled).toBe(true)
    expect(capability.setIdentity).not.toHaveBeenCalled()
  })

  it('shows the server\'s reason when a save is refused, and keeps the draft', async () => {
    const capability = manage({})
    capability.setIdentity.mockRejectedValueOnce(new Error('Name must not contain control characters.'))
    await open(capability)

    type('Name', 'Acme')
    await act(async () => saveButton().click())

    expect(testState.addToast).toHaveBeenCalledWith(
      { title: 'Name must not contain control characters.', variant: 'error' })
    expect(container!.querySelector<HTMLInputElement>('input[placeholder="Cloudflare OS"]')!.value).toBe('Acme')
  })

  it('releases the capability when the page closes', async () => {
    const capability = manage({})
    await open(capability)
    act(() => root!.unmount())
    root = undefined
    expect(capability[Symbol.dispose]).toHaveBeenCalled()
  })
})
