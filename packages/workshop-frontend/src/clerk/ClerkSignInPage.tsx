import { SignIn, SignUp } from '@clerk/react'
import { useDocumentTitle } from '../useDocumentTitle'

/** The sign-in or sign-up screen of a Clerk deployment, in the app's login layout. */
const ClerkSignInPage = ({ mode }: { mode: 'sign-in' | 'sign-up' }) => {
  useDocumentTitle(mode === 'sign-in' ? 'Sign in' : 'Create account')
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto bg-kumo-base px-4 py-8">
      {mode === 'sign-in'
        ? <SignIn routing="hash" signUpUrl="/signup" />
        : <SignUp routing="hash" signInUrl="/" />}
    </div>
  )
}

export default ClerkSignInPage
