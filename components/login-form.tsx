import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
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
        <Button type="submit" className="w-full">
          {isPending ? 'loading...' : 'Login'}
        </Button>
      </div>
    </form>
  )
}
