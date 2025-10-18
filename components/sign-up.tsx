'use client'

import { useActionState } from 'react'
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import toast from 'react-hot-toast'
import { signUp, type ActionResponse } from "@/actions/auth"

const initalState: ActionResponse = {
  success: false,
  message: '',
  errors: undefined
}

interface SignupFormProps extends React.ComponentProps<"form"> {
  onSuccess?: () => void;
}

export function SignupForm({
  className,
  onSuccess,
  ...props
}: SignupFormProps) {
  const [state, formAction, isPending] = useActionState<ActionResponse>(
    async (prevState: ActionResponse, formData: FormData) => {
      try {
        const result = await signUp(formData)
        
        // Handle successful submission
        if (result.success) {
          toast.success('Account created successfully')
          
          // Call the onSuccess callback to refresh the parent's user list
          onSuccess?.()
        }
        
        return result
      } catch (error) {
        toast.error(`${state.message}`)
        return {
          success: false,
          message: (error as Error).message || 'error occurred',
          errors: undefined
        }
      }
    }, 
    initalState
  )

  return (
    <form action={formAction} className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Sign up a employee to use Billboard Source AI.</h1>
        <p className="text-muted-foreground text-sm text-balance">
          Enter the email below
        </p>
      </div>
      
      <div className="grid gap-6">
        <div className="grid gap-3">
          <Label htmlFor="email">Email</Label>
          <Input 
            id="email" 
            type="email" 
            name="email" 
            placeholder="m@example.com" 
            required 
            disabled={isPending} 
          />
          {state?.errors?.email && (
            <p id="email-error" className="text-sm text-red-500">
              {state.errors.email[0]}
            </p>
          )}
        </div>
        
        <div className="grid gap-3">
          <div className="flex items-center">
            <Label htmlFor="password">Password</Label>
          </div>
          <Input 
            id="password" 
            type="password" 
            name="password" 
            placeholder="must be at least 6 characters" 
            required 
            disabled={isPending} 
          />
          {state?.errors?.password && (
            <p id="password-error" className="text-sm text-red-500">
              {state.errors.password[0]}
            </p>
          )}
          
          <div className="flex items-center">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
          </div>
          <Input 
            id="confirmPassword" 
            name="confirmPassword" 
            type="password" 
            required 
            disabled={isPending} 
          />
          {state?.errors?.confirmPassword && (
            <p id="confirmPassword-error" className="text-sm text-red-500">
              {state.errors.confirmPassword[0]}
            </p>
          )}
        </div>
        
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? 'Loading user...' : 'Create User'}
        </Button>
      </div>
    </form>
  )
}
