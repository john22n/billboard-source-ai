import { useActionState, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn, checkUserHasPasskeys, type ActionResponse } from '@/actions/auth'
import toast from 'react-hot-toast'

type LoginStep = 'email' | 'password' | 'passkey-auth' | 'passkey-setup'

const initialState: ActionResponse = {
  success: false,
  message: '',
  errors: undefined
}

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"form">) {
  const router = useRouter()
  const [step, setStep] = useState<LoginStep>('email')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false)

  // Handle passkey authentication for returning users
  const handlePasskeyAuth = useCallback(async () => {
    if (!browserSupportsWebAuthn()) {
      toast.error('Your browser does not support passkeys')
      setStep('password')
      return
    }

    setIsPasskeyLoading(true)
    try {
      // Get authentication options for this specific user
      const optionsRes = await fetch('/api/passkey/auth-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!optionsRes.ok) {
        throw new Error('Failed to get authentication options')
      }

      const options = await optionsRes.json()

      // Prompt user for passkey
      const authResponse = await startAuthentication({ optionsJSON: options })

      // Verify with server
      const verifyRes = await fetch('/api/passkey/auth-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: authResponse }),
      })

      const verifyData = await verifyRes.json()

      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Authentication failed')
      }

      toast.success('Signed in with passkey')
      router.push('/dashboard')
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Passkey authentication failed'
      if (!message.includes('cancelled') && !message.includes('abort')) {
        toast.error(message)
      }
      // Fall back to password login on failure
      setStep('password')
    } finally {
      setIsPasskeyLoading(false)
    }
  }, [email, router])

  // Handle email submission to check if user has passkeys
  const handleEmailSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!email.trim()) return

    setIsLoading(true)
    try {
      const result = await checkUserHasPasskeys(email)

      if (!result.exists) {
        // User doesn't exist, show password form for error handling
        setStep('password')
        return
      }

      if (result.hasPasskeys && browserSupportsWebAuthn()) {
        // User has passkeys, authenticate with passkey
        setStep('passkey-auth')
        await handlePasskeyAuth()
      } else {
        // User exists but has no passkeys, show password form
        setStep('password')
      }
    } catch {
      toast.error('Failed to check account status')
      setStep('password')
    } finally {
      setIsLoading(false)
    }
  }, [email, handlePasskeyAuth])

  // Handle passkey registration after first password login
  const handlePasskeySetup = useCallback(async () => {
    if (!browserSupportsWebAuthn()) {
      toast.error('Your browser does not support passkeys')
      router.push('/dashboard')
      router.refresh()
      return
    }

    setIsPasskeyLoading(true)
    try {
      // Get registration options
      const optionsRes = await fetch('/api/passkey/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!optionsRes.ok) {
        throw new Error('Failed to get registration options')
      }

      const options = await optionsRes.json()

      // Prompt user to create passkey
      const registrationResponse = await startRegistration({ optionsJSON: options })

      // Verify and save passkey
      const verifyRes = await fetch('/api/passkey/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: registrationResponse,
          name: 'Login Passkey'
        }),
      })

      const verifyData = await verifyRes.json()

      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Failed to register passkey')
      }

      toast.success('Passkey created! You can now sign in with your passkey.')
      router.push('/dashboard')
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Passkey setup failed'
      if (!message.includes('cancelled') && !message.includes('abort')) {
        toast.error(message)
      }
      // Continue to dashboard even if passkey setup fails
      router.push('/dashboard')
      router.refresh()
    } finally {
      setIsPasskeyLoading(false)
    }
  }, [router])

  // Handle password form submission
  const [state, formAction, isPending] = useActionState<
    ActionResponse,
    FormData
  >(async (prevState: ActionResponse, formData: FormData) => {
    try {
      // Ensure email is included in form data
      formData.set('email', email)
      const result = await signIn(formData)

      if (result.success) {
        if (result.requiresPasskeySetup && browserSupportsWebAuthn()) {
          // First login - prompt to set up passkey
          toast.success('Signed in! Let\'s set up your passkey for faster login.')
          setStep('passkey-setup')
          // Small delay to ensure session is ready
          setTimeout(() => handlePasskeySetup(), 500)
        } else {
          toast.success('Signed in successfully')
          router.push('/dashboard')
          router.refresh()
        }
      }

      return result
    } catch {
      toast.error('Network error')
      return {
        success: false,
        message: 'An error occurred',
        errors: undefined
      }
    }
  }, initialState)

  // Go back to email step
  const handleBack = () => {
    setStep('email')
    setEmail('')
  }

  // Render email step
  if (step === 'email') {
    return (
      <form onSubmit={handleEmailSubmit} className={cn("flex flex-col gap-6", className)} {...props}>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">Login to your account</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Enter your email to continue
          </p>
        </div>
        <div className="grid gap-6">
          <div className="grid gap-3">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              name="email"
              placeholder="you@billboardsource.com"
              required
              disabled={isLoading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className='bg-white'
            />
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Checking...' : 'Continue'}
          </Button>
        </div>
      </form>
    )
  }

  // Render passkey authentication step (for returning users with passkeys)
  if (step === 'passkey-auth') {
    return (
      <div className={cn("flex flex-col gap-6", className)}>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">Welcome back!</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Use your passkey to sign in
          </p>
        </div>
        <div className="grid gap-4">
          <div className="p-4 bg-muted/50 rounded-lg text-center">
            <p className="text-sm text-muted-foreground mb-1">Signing in as</p>
            <p className="font-medium">{email}</p>
          </div>
          <Button
            onClick={handlePasskeyAuth}
            className="w-full"
            disabled={isPasskeyLoading}
          >
            {isPasskeyLoading ? (
              'Authenticating...'
            ) : (
              <>
                <svg
                  className="mr-2 h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5Z" />
                  <path d="M12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7Z" />
                </svg>
                Sign in with Passkey
              </>
            )}
          </Button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep('password')}
            disabled={isPasskeyLoading}
          >
            Use password instead
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleBack}
            disabled={isPasskeyLoading}
          >
            Use a different email
          </Button>
        </div>
      </div>
    )
  }

  // Render passkey setup step (after first password login)
  if (step === 'passkey-setup') {
    return (
      <div className={cn("flex flex-col gap-6", className)}>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">Set up your passkey</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Create a passkey for faster, more secure logins
          </p>
        </div>
        <div className="grid gap-4">
          <div className="p-4 bg-muted/50 rounded-lg">
            <ul className="text-sm text-muted-foreground space-y-2">
              <li>No password needed for future logins</li>
              <li>Uses Face ID, Touch ID, or your device PIN</li>
              <li>More secure than passwords</li>
            </ul>
          </div>
          {isPasskeyLoading ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">Setting up passkey...</p>
            </div>
          ) : (
            <>
              <Button
                onClick={handlePasskeySetup}
                className="w-full"
              >
                <svg
                  className="mr-2 h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5Z" />
                  <path d="M12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7Z" />
                </svg>
                Create Passkey
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  router.push('/dashboard')
                  router.refresh()
                }}
              >
                Skip for now
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }

  // Render password step (for users without passkeys or password fallback)
  return (
    <form action={formAction} className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Enter your password</h1>
        <p className="text-muted-foreground text-sm text-balance">
          Sign in to your account
        </p>
      </div>
      <div className="grid gap-6">
        <div className="p-4 bg-muted/50 rounded-lg text-center">
          <p className="text-sm text-muted-foreground mb-1">Signing in as</p>
          <p className="font-medium">{email}</p>
        </div>
        {state?.errors?.email && (
          <p className="text-sm text-red-500 text-center">
            {state.errors.email[0]}
          </p>
        )}
        <div className="grid gap-3">
          <div className="flex items-center">
            <Label htmlFor="password">Password</Label>
            <a
              href="#"
              className="ml-auto text-sm underline-offset-4 hover:underline"
            >
              Forgot your password?
            </a>
          </div>
          <Input
            id="password"
            type="password"
            required
            name="password"
            disabled={isPending}
            className='bg-white'
            autoFocus
          />
          {state?.errors?.password && (
            <p className="text-sm text-red-500">
              {state.errors.password[0]}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? 'Signing in...' : 'Sign in'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={handleBack}
          disabled={isPending}
        >
          Use a different email
        </Button>
      </div>
    </form>
  )
}
