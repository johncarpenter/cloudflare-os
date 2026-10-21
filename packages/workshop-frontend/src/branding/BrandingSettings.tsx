import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { RpcStub } from 'capnweb'
import { Button, Input, useKumoToastManager } from '@cloudflare/kumo'
import { Hexagon, ShieldWarning } from '@phosphor-icons/react'
import {
  DEFAULT_SITE_NAME, MAX_SITE_NAME_LENGTH, isHexColor,
  type TenantAdminApi, type TenantBranding,
} from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../AuthContext'
import { prepareSiteLogo } from '../siteLogoUtils'
import { DEFAULT_ACCENT_COLOR } from '../theme'
import { useDocumentTitle } from '../useDocumentTitle'
import { useTenantBranding } from './useTenantBranding'

type Editing = { api: RpcStub<TenantAdminApi>; saved: TenantBranding }

// Why a draft cannot be saved, or null. The server checks the same rules; this saves the round trip.
function nameProblem(name: string): string | null {
  if (name.length > MAX_SITE_NAME_LENGTH) return `Use at most ${MAX_SITE_NAME_LENGTH} characters.`
  return null
}

function accentProblem(color: string): string | null {
  return color === '' || isHexColor(color) ? null : 'Use a hex color such as #3b82f6.'
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * The organization's branding page: its name, logo and accent color, for the organization's
 * administrators. Anyone else sees that they have no access. Changes show to the whole
 * organization on their next reading (see `TenantBrandingProvider`), starting with this session.
 */
const BrandingSettings = () => {
  const { authenticatedApi } = useAuthenticatedApi()
  const { refresh } = useTenantBranding()
  const toasts = useKumoToastManager()
  useDocumentTitle('Organization branding')

  // The capability, wrapped so useState does not call the (callable) RPC stub as an updater.
  const [editing, setEditing] = useState<Editing | null>(null)
  const [state, setState] = useState<'loading' | 'denied' | 'failed' | 'ready'>('loading')
  const [nameDraft, setNameDraft] = useState('')
  const [accentDraft, setAccentDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingLogo, setSavingLogo] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    let stub: RpcStub<TenantAdminApi> | null = null
    ;(async () => {
      const api = await authenticatedApi.getTenantAdminApi()
      if (cancelled) {
        api?.[Symbol.dispose]?.()
        return
      }
      if (!api) {
        setState('denied')
        return
      }
      stub = api
      const saved = await api.getBranding()
      if (cancelled) return
      setEditing({ api, saved })
      setNameDraft(saved.name ?? '')
      setAccentDraft(saved.accentColor ?? '')
      setState('ready')
    })().catch(() => { if (!cancelled) setState('failed') })
    return () => {
      cancelled = true
      stub?.[Symbol.dispose]?.()
    }
  }, [authenticatedApi])

  // The saved logo as an image the page can show; revoked when it changes or the page closes.
  const savedLogo = editing?.saved.logo
  useEffect(() => {
    if (!savedLogo) {
      setLogoUrl(null)
      return
    }
    const url = URL.createObjectURL(new Blob([savedLogo as BlobPart], { type: 'image/png' }))
    setLogoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [savedLogo])

  if (state === 'loading') {
    return <p className="p-8 text-kumo-subtle">Loading organization branding...</p>
  }
  if (state === 'denied') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <ShieldWarning size={32} className="mx-auto mb-3 text-kumo-subtle" />
        <p className="text-sm text-kumo-default">Only organization administrators can change branding.</p>
      </div>
    )
  }
  if (state === 'failed' || !editing) {
    return <p className="p-8 text-sm text-kumo-danger">Something went wrong loading organization branding.</p>
  }

  const { api, saved } = editing
  const name = nameDraft.trim()
  const nameError = nameProblem(name)
  const accentError = accentProblem(accentDraft)
  const changed = name !== (saved.name ?? '') || accentDraft !== (saved.accentColor ?? '')

  const reload = async () => {
    setEditing({ api, saved: await api.getBranding() })
    refresh()
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.setIdentity({ name: name || null, accentColor: accentDraft || null })
      await reload()
      toasts.add({ title: 'Branding saved', variant: 'success' })
    } catch (error) {
      toasts.add({ title: messageOf(error, 'Failed to save branding'), variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const changeLogo = async (change: () => Promise<void>, done: string) => {
    setSavingLogo(true)
    try {
      await change()
      await reload()
      toasts.add({ title: done, variant: 'success' })
    } catch (error) {
      toasts.add({ title: messageOf(error, 'Failed to save the logo'), variant: 'error' })
    } finally {
      setSavingLogo(false)
    }
  }

  const handleLogoChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await changeLogo(async () => api.setLogo(await prepareSiteLogo(file)), 'Logo saved')
  }

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6 px-4 py-8 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold text-kumo-default">Organization branding</h1>
        <p className="mt-1 text-sm text-kumo-subtle">
          Shown to everyone in this organization in place of the deployment&rsquo;s. Anything you
          leave unset keeps the deployment&rsquo;s.
        </p>
      </div>

      <div className="space-y-5 rounded-xl border border-kumo-line bg-kumo-elevated p-6">
        <Input
          label="Name"
          description={`Shown next to the logo. Leave empty to use the default (\u201C${DEFAULT_SITE_NAME}\u201D).`}
          value={nameDraft}
          placeholder={DEFAULT_SITE_NAME}
          error={nameError ?? undefined}
          onChange={(event) => setNameDraft(event.target.value)}
        />

        <div>
          <p className="mb-2 text-sm font-medium text-kumo-default">Accent color</p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="color"
              aria-label="Accent color"
              value={isHexColor(accentDraft) && accentDraft.length === 7 ? accentDraft : DEFAULT_ACCENT_COLOR}
              onChange={(event) => setAccentDraft(event.target.value)}
              className="h-9 w-9 cursor-pointer rounded-md border border-kumo-line bg-transparent p-0.5"
            />
            <Input
              aria-label="Accent color value"
              size="sm"
              value={accentDraft}
              placeholder="Deployment default"
              error={accentError ?? undefined}
              onChange={(event) => setAccentDraft(event.target.value.trim())}
            />
            {accentDraft !== '' && (
              <Button variant="ghost" size="sm" onClick={() => setAccentDraft('')}>
                Use the deployment&rsquo;s
              </Button>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {changed && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => { setNameDraft(saved.name ?? ''); setAccentDraft(saved.accentColor ?? '') }}
            >
              Reset
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={!changed || nameError !== null || accentError !== null}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-kumo-line bg-kumo-elevated p-6">
        <h2 className="mb-1 text-lg font-semibold text-kumo-strong">Logo</h2>
        <p className="mb-5 text-sm text-kumo-subtle">
          Images are scaled without cropping and converted to a static PNG. Square images work best.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-kumo-line bg-kumo-base p-2">
            {logoUrl
              ? <img src={logoUrl} alt="Organization logo" className="max-h-full max-w-full object-contain" />
              : <Hexagon size={32} weight="bold" className="text-kumo-brand" />}
          </div>
          <input
            ref={logoInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            disabled={savingLogo}
            onChange={handleLogoChosen}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={savingLogo}
              onClick={() => logoInput.current?.click()}
            >
              {saved.logo ? 'Change logo' : 'Upload logo'}
            </Button>
            {saved.logo && (
              <Button
                variant="ghost"
                size="sm"
                disabled={savingLogo}
                onClick={() => changeLogo(() => api.setLogo(null), 'Logo removed')}
              >
                Use the deployment&rsquo;s
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default BrandingSettings
