import { useState, useEffect, useRef } from 'react'
import { RpcStub } from 'capnweb'
import { PublicApi, AuthenticatedApi, AUTH_ERROR_CODES, getAuthErrorCode } from '@gadgets/workshop-shared/api'
import { setReportedUserId } from './errorReporting'
import { useClerkBridge } from './clerk/clerkBridge'
import { restoreOrRememberWorkspace, startSessionRenewal } from './clerk/clerkSession'

const CF_ACCESS_MODE = import.meta.env.VITE_CF_ACCESS_MODE === 'true'

interface AuthState {
  token: string | null
  authenticatedApi: RpcStub<AuthenticatedApi> | null
  isLoading: boolean
  error: string | null
}

export { CF_ACCESS_MODE }

export function useAuth(publicApi: RpcStub<PublicApi>) {
  const [authState, setAuthState] = useState<AuthState>({
    token: null,
    authenticatedApi: null,
    isLoading: true,
    error: null
  })

  // Track current authenticated API stub for cleanup on unmount.
  // State closures go stale in cleanup functions, so we use a ref.
  const authenticatedApiRef = useRef<RpcStub<AuthenticatedApi> | null>(null)
  authenticatedApiRef.current = authState.authenticatedApi

  // Clerk, when it is this deployment's sign-in method. Its functions are read through a ref so the
  // effect below restarts only when the signed-in user or active organization actually changes.
  const clerk = useClerkBridge()
  const clerkRef = useRef(clerk)
  clerkRef.current = clerk
  const clerkLoaded = clerk?.isLoaded ?? false
  const clerkSignedIn = clerk?.isSignedIn ?? false
  const clerkUserId = clerk?.userId ?? null
  const clerkOrgId = clerk?.orgId ?? null
  // Bumped when the server refuses a renewal, to re-authenticate from scratch.
  const [clerkEpoch, setClerkEpoch] = useState(0)

  /**
   * Names the signed-in user on error reports, for as long as this stub is the current one.
   *
   * Keyed on the stub rather than called from each authenticate path, so it covers however the
   * session was established — stored token, inline login, or CF Access. This is why the claim lives
   * in the hook and not in `AuthProvider`: the public blueprint page renders outside that provider
   * and logs in inline, so reports from the rest of its session would otherwise name nobody.
   *
   * `whoami` is pipelined rather than awaited, so its answer can outlive the session that asked.
   * The cleanup drops it when the stub is replaced or cleared, which is what stops a logout or a
   * newer login from being overwritten by the previous user. Disposal would not be enough on its
   * own: capnweb does not guarantee that disposing a stub rejects calls already in flight.
   *
   * Nothing is cleared here. Cleanup also runs on unmount, and two instances of this hook can be
   * mounted at once — the blueprint page runs its own inside the root's — so an inner one going
   * away must not blank an identity the outer still holds. `logout` is the only thing that clears.
   */
  useEffect(() => {
    const authenticatedApi = authState.authenticatedApi
    if (!authenticatedApi) return
    let cancelled = false
    authenticatedApi.whoami().then((info) => {
      // Only a real user account names a person: for a gadget author `id` is its owner's id.
      if (!cancelled && info.type === 'user') setReportedUserId(info.id)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [authState.authenticatedApi])

  useEffect(() => {
    if (clerkRef.current) {
      // Sign-in is Clerk's (see the effect below); a stored Workshop token is not used.
    } else if (CF_ACCESS_MODE) {
      authenticateWithCfAccess()
    } else {
      const storedToken = localStorage.getItem('authToken')
      if (storedToken) {
        authenticateWithToken(storedToken)
      } else {
        setAuthState(prev => ({ ...prev, isLoading: false }))
      }
    }
    return () => {
      // The authenticateWithXxx functions also dispose the old stub via their setAuthState
      // updater, so this may double-dispose on reconnect. That's fine — dispose is idempotent.
      authenticatedApiRef.current?.[Symbol.dispose]()
    }
  }, [publicApi])

  // Clerk sign-in: one authenticated connection per (user, active organization). Changing either
  // drops the old connection first, so nothing from the previous workspace stays on screen.
  useEffect(() => {
    const bridge = clerkRef.current
    if (!bridge || !bridge.isLoaded) return
    let cancelled = false
    let stopRenewal: (() => void) | undefined

    setAuthState(prev => {
      prev.authenticatedApi?.[Symbol.dispose]()
      return { token: null, authenticatedApi: null, isLoading: bridge.isSignedIn, error: null }
    })
    if (!bridge.isSignedIn) return

    const fail = (message: string) => {
      setAuthState(prev => {
        prev.authenticatedApi?.[Symbol.dispose]()
        return { token: null, authenticatedApi: null, isLoading: false, error: message }
      })
    }

    bridge.getToken().then((token) => {
      if (cancelled) return
      if (!token) {
        fail('Could not start your session. Please sign in again.')
        return
      }
      // Pipelined, like the other sign-in paths; whoami() below surfaces a refusal.
      const authenticatedApi = publicApi.authenticateFromClerk(token)
      setAuthState({ token: null, authenticatedApi, isLoading: false, error: null })
      authenticatedApi.whoami().then(() => {
        if (cancelled) return
        stopRenewal = startSessionRenewal(
          authenticatedApi,
          (options) => bridge.getToken(options),
          () => setClerkEpoch((epoch) => epoch + 1))
        restoreOrRememberWorkspace(
          authenticatedApi, (organizationId) => bridge.switchOrganization(organizationId),
        ).catch(() => {})
      }).catch((error) => {
        // A dropped connection is replaced by main.tsx, which restarts this effect; only the
        // server's own refusals are final here.
        if (cancelled || getAuthErrorCode(error) === undefined) return
        if (getAuthErrorCode(error) === AUTH_ERROR_CODES.sessionNotPermitted && bridge.orgId) {
          // Not (or no longer) a member of this organization: continue in the personal workspace.
          bridge.switchOrganization(null).catch(() => fail(error.message))
          return
        }
        fail(error instanceof Error ? error.message : 'This session is not permitted.')
      })
    }).catch(() => {
      if (!cancelled) fail('Could not start your session. Please sign in again.')
    })

    return () => {
      cancelled = true
      stopRenewal?.()
    }
  }, [publicApi, clerkLoaded, clerkSignedIn, clerkUserId, clerkOrgId, clerkEpoch])

  const authenticateWithCfAccess = () => {
    setAuthState(prev => {
      if (prev.authenticatedApi) {
        prev.authenticatedApi[Symbol.dispose]()
      }
      return { ...prev, authenticatedApi: null, isLoading: true, error: null }
    })

    // Use promise pipelining - no need to await. The CF Access JWT is already attached
    // to the request by the browser (injected by the Access service worker/cookie), so
    // the server validates it and returns an authenticated stub immediately.
    const authenticatedApi = publicApi.authenticateFromCfAccess()
    setAuthState({
      token: null,
      authenticatedApi,
      isLoading: false,
      error: null
    })
  }

  const authenticateWithToken = (token: string) => {
    setAuthState(prev => {
      // Dispose the previous authenticated API stub if it exists
      if (prev.authenticatedApi) {
        prev.authenticatedApi[Symbol.dispose]()
      }
      return {
        ...prev,
        authenticatedApi: null, // Clear the disposed stub
        isLoading: true,
        error: null
      }
    })

    // Use promise pipelining - we can use the returned promise as a stub immediately
    // without awaiting. Authentication errors will be handled when the stub is actually used.
    const authenticatedApi = publicApi.authenticate(token)
    setAuthState({
      token,
      authenticatedApi,
      isLoading: false,
      error: null
    })
  }

  const login = (token: string) => {
    authenticateWithToken(token)
  }

  const logout = () => {
    setReportedUserId(undefined)

    if (clerkRef.current) {
      setAuthState(prev => {
        prev.authenticatedApi?.[Symbol.dispose]()
        return { token: null, authenticatedApi: null, isLoading: false, error: null }
      })
      void clerkRef.current.signOut()
      return
    }

    if (CF_ACCESS_MODE) {
      window.location.assign('/cdn-cgi/access/logout')
      return
    }

    // Use functional updater to read current state (avoids stale closure).
    setAuthState(prev => {
      if (prev.authenticatedApi) {
        prev.authenticatedApi[Symbol.dispose]()
      }
      return {
        token: null,
        authenticatedApi: null,
        isLoading: false,
        error: null
      }
    })

    localStorage.removeItem('authToken')
  }

  return {
    ...authState,
    // Clerk has to report whether anyone is signed in before we know what to show.
    isLoading: authState.isLoading || (clerk !== null && !clerk.isLoaded),
    login,
    logout,
    isAuthenticated: !!authState.authenticatedApi
  }
}
