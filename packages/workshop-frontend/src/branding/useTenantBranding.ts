import { createContext, useContext } from 'react'

/** What the signed-in session can do with its organization's branding. */
export type TenantBrandingState = {
  /** Whether this session may edit the organization's branding (see `getTenantAdminApi()`). */
  canManage: boolean
  /** Reads the branding again, after it was changed. */
  refresh: () => void
}

export const TenantBrandingContext = createContext<TenantBrandingState>({
  canManage: false,
  refresh: () => {},
})

/** The branding controls of the signed-in session. Inert outside a `TenantBrandingProvider`. */
export function useTenantBranding(): TenantBrandingState {
  return useContext(TenantBrandingContext)
}
