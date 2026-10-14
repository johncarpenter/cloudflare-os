import { ReactNode } from 'react'
import { ClerkProvider, useAuth, useClerk } from '@clerk/react'
import { useServerConfig } from '../ServerConfigContext'
import { ClerkBridgeContext } from './clerkBridge'

/** Exposes Clerk's session to the rest of the app through the bridge. Lives inside ClerkProvider. */
const ClerkBridgeProvider = ({ children }: { children: ReactNode }) => {
  const { isLoaded, isSignedIn, userId, orgId, getToken, signOut } = useAuth()
  const clerk = useClerk()
  return (
    <ClerkBridgeContext.Provider value={{
      isLoaded,
      isSignedIn: isSignedIn === true,
      userId,
      orgId,
      getToken,
      signOut: () => signOut(),
      switchOrganization: (organizationId) => clerk.setActive({ organization: organizationId }),
      openUserProfile: () => clerk.openUserProfile(),
    }}>
      {children}
    </ClerkBridgeContext.Provider>
  )
}

/**
 * Starts Clerk when the deployment uses it (ServerConfig.clerk), and renders its children as they
 * are otherwise. The publishable key arrives at runtime, so one frontend build serves every
 * deployment.
 */
const ClerkAppProvider = ({ children }: { children: ReactNode }) => {
  const clerk = useServerConfig()?.clerk
  if (!clerk) return <>{children}</>
  return (
    <ClerkProvider publishableKey={clerk.publishableKey} afterSignOutUrl="/">
      <ClerkBridgeProvider>{children}</ClerkBridgeProvider>
    </ClerkProvider>
  )
}

export default ClerkAppProvider
