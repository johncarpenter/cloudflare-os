import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { EffectiveBranding } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../AuthContext'
import { ServerConfigContext, useServerConfig } from '../ServerConfigContext'
import { applySiteFavicon } from '../siteLogoUtils'
import { applyAccentColor } from '../theme'
import { mergeBranding } from './mergeBranding'
import { TenantBrandingContext } from './useTenantBranding'

// A reading belongs to the connection that made it, so switching organization (a new connection)
// never shows the previous organization's branding while the new one loads.
type Reading = { api: unknown; branding: EffectiveBranding | null; canManage: boolean }

/**
 * Shows the signed-in organization's branding over the deployment's: everything below reads the
 * merged config from `ServerConfigContext`, and the accent color and favicon follow it. Mounted
 * only for a signed-in session, so the sign-in pages keep the deployment's branding. A failed
 * reading leaves the deployment's branding in place.
 */
const TenantBrandingProvider = ({ children }: { children: ReactNode }) => {
  const { authenticatedApi } = useAuthenticatedApi()
  const deployment = useServerConfig()
  const [reading, setReading] = useState<Reading | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [branding, manage] = await Promise.all([
        authenticatedApi.getBranding(),
        authenticatedApi.getTenantAdminApi(),
      ])
      // Only whether the capability exists is needed here; the settings page mints its own.
      manage?.[Symbol.dispose]?.()
      if (!cancelled) setReading({ api: authenticatedApi, branding, canManage: manage !== null })
    })().catch(() => {})
    return () => { cancelled = true }
  }, [authenticatedApi, revision])

  const current = reading?.api === authenticatedApi ? reading : null
  const branding = current?.branding ?? null

  // Context consumers re-render when this changes, so it must keep its identity between renders.
  const merged = useMemo(() => mergeBranding(deployment, branding), [deployment, branding])
  const state = useMemo(() => ({
    canManage: current?.canManage ?? false,
    refresh: () => setRevision((value) => value + 1),
  }), [current?.canManage])

  const accentColor = merged?.accentColor ?? ''
  useEffect(() => {
    applyAccentColor(accentColor)
  }, [accentColor])

  const logoUrl = merged?.siteLogo?.url
  useEffect(() => applySiteFavicon(logoUrl), [logoUrl])

  return (
    <ServerConfigContext.Provider value={merged}>
      <TenantBrandingContext.Provider value={state}>{children}</TenantBrandingContext.Provider>
    </ServerConfigContext.Provider>
  )
}

export default TenantBrandingProvider
