import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn, type ActionResponse } from '@/actions/auth'
import toast from 'react-hot-toast'

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
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false)

  // Handle passkey authentication
  const handlePasskeyLogin = async () => {
    if (!browserSupportsWebAuthn()) {
      toast.error('Your browser does not support passkeys')
      return
    }

    setIsPasskeyLoading(true)

    try {
      // Get authentication options from server
      const optionsRes = await fetch('/api/passkey/auth-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      // User cancelled or error occurred
      const message = error instanceof Error ? error.message : 'Passkey authentication failed'
      if (!message.includes('cancelled') && !message.includes('abort')) {
        toast.error(message)
      }
    } finally {
      setIsPasskeyLoading(false)
    }
  }

  //use actionState hook for the form submission action
  const [state, formAction, isPending] = useActionState<
    ActionResponse,
    FormData
  >(async (prevState: ActionResponse, formData: FormData) => {
    try {
      const result = await signIn(formData)

      //handle success
      if (result.success) {
        toast.success('signed in successfully')
        router.push('/dashboard')
        router.refresh()
      }

      return result
    } catch (error) {
      toast.error(`network error`)
      return {
        success: false,
        message: (error as Error).message || 'an error occured',
        errors: undefined
      }
    }
  }, initialState)

  return (
    <form action={formAction} className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Login to your account</h1>
        <p className="text-muted-foreground text-sm text-balance">
          Enter your email below to login to your account
        </p>
      </div>
      <div className="grid gap-6">
        <div className="grid gap-3">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" name="email" placeholder="m@example.com" required disabled={isPending} className='bg-white' />
          {state?.errors?.email && (
            <p id="password-error" className="text-sm text-red-500">
              {state.errors.email[0]}
            </p>
          )}
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
          <Input id="password" type="password" required name="password" disabled={isPending} className='bg-white' />
          {state?.errors?.password && (
            <p id="password-error" className="text-sm text-red-500">
              {state.errors.password[0]}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={isPending || isPasskeyLoading}>
          {isPending ? 'loading...' : 'Login'}
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or continue with
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handlePasskeyLogin}
          disabled={isPending || isPasskeyLoading}
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
      </div>
    </form>
  )
}
