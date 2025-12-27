import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn } from '@/actions/auth'
import { showErrorToast, showSuccessToast, getErrorMessage } from '@/lib/error-handling'

type LoginStep = 'email' | 'passkey' | 'password'

export function LoginForm({
  className,
}: {
  className?: string
}) {
  const router = useRouter()
  const [step, setStep] = useState<LoginStep>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      const res = await fetch('/api/auth/check-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to check user')
      }

      if (!data.exists) {
        setError('User not found. Please check your email.')
        setIsLoading(false)
        return
      }

      if (data.hasPasskeys && browserSupportsWebAuthn()) {
        setStep('passkey')
        await handlePasskeyAuth()
      } else {
        setStep('password')
        setIsLoading(false)
      }
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      showErrorToast(message)
      setIsLoading(false)
    }
  }

  const handlePasskeyAuth = async () => {
    setIsLoading(true)

    try {
      const optionsRes = await fetch('/api/passkey/auth-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!optionsRes.ok) {
        throw new Error('Failed to get authentication options')
      }

      const options = await optionsRes.json()
      const authResponse = await startAuthentication({ optionsJSON: options })

      const verifyRes = await fetch('/api/passkey/auth-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: authResponse }),
      })

      const verifyData = await verifyRes.json()

      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Passkey authentication failed')
      }

      showSuccessToast('Signed in with passkey')
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      const message = getErrorMessage(err)
      if (!message.includes('cancelled') && !message.includes('abort')) {
        showErrorToast(message)
      }
      setStep('password')
      setIsLoading(false)
    }
  }

  const registerPasskey = async () => {
    if (!browserSupportsWebAuthn()) {
      return
    }

    try {
      const optionsRes = await fetch('/api/passkey/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!optionsRes.ok) {
        return
      }

      const options = await optionsRes.json()
      const regResponse = await startRegistration({ optionsJSON: options })

      const verifyRes = await fetch('/api/passkey/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: regResponse,
          name: 'Auto-registered passkey',
        }),
      })

      if (verifyRes.ok) {
        showSuccessToast('Passkey registered for faster login next time')
      }
    } catch {
      // Silently fail - passkey registration is optional
    }
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      const formData = new FormData()
      formData.append('email', email)
      formData.append('password', password)

      const result = await signIn(formData)

      if (result.success) {
        showSuccessToast('Signed in successfully')
        
        // Auto-register passkey in background
        registerPasskey()
        
        router.push('/dashboard')
        router.refresh()
      } else {
        setError(result.message || 'Invalid credentials')
        if (result.errors?.password) {
          setError(result.errors.password[0])
        }
        if (result.errors?.email) {
          setError(result.errors.email[0])
        }
        setIsLoading(false)
      }
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      showErrorToast(message)
      setIsLoading(false)
    }
  }

  const handleBack = () => {
    setStep('email')
    setPassword('')
    setError(null)
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Login to your account</h1>
        <p className="text-muted-foreground text-sm text-balance">
          {step === 'email' && 'Enter your email below to login'}
          {step === 'passkey' && 'Authenticating with passkey...'}
          {step === 'password' && 'Enter your password to continue'}
        </p>
      </div>

      {step === 'email' && (
        <form onSubmit={handleEmailSubmit} className="grid gap-6">
          <div className="grid gap-3">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="m@example.com"
              required
              disabled={isLoading}
              className="bg-white"
            />
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Checking...' : 'Continue'}
          </Button>
        </form>
      )}

      {step === 'passkey' && (
        <div className="grid gap-6">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-pulse">
              <svg
                className="h-16 w-16 text-primary"
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
            </div>
            <p className="text-muted-foreground text-sm">
              Please verify with your passkey
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleBack}
            disabled={isLoading}
          >
            Cancel
          </Button>
        </div>
      )}

      {step === 'password' && (
        <form onSubmit={handlePasswordSubmit} className="grid gap-6">
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{email}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="h-auto p-1 text-xs"
              >
                Change
              </Button>
            </div>
          </div>
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
              className="bg-white"
              autoFocus
            />
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Signing in...' : 'Login'}
          </Button>
        </form>
      )}
    </div>
  )
}
