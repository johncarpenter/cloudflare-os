import { createContext, useContext } from 'react'

/**
 * What the Workshop needs from Clerk, so the rest of the app never imports Clerk's hooks and keeps
 * working, unchanged, on deployments that don't use it.
 */
export type ClerkBridge = {
  /** False until Clerk has loaded the browser's session. */
  isLoaded: boolean
  isSignedIn: boolean
  userId: string | null | undefined
  /** The active organization, or null/undefined for the personal workspace. */
  orgId: string | null | undefined
  /** A session token for the current user and active organization. */
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>
  signOut: () => Promise<void>
  /** Makes `organizationId` the active organization, or the personal workspace for null. */
  switchOrganization: (organizationId: string | null) => Promise<void>
  openUserProfile: () => void
}

export const ClerkBridgeContext = createContext<ClerkBridge | null>(null)

/** The Clerk bridge, or null when Clerk is not this deployment's sign-in method. */
export function useClerkBridge(): ClerkBridge | null {
  return useContext(ClerkBridgeContext)
}
