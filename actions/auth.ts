'use server'

import { z } from 'zod'
import {
  verifyPassword,
  createSession,
  createUser,
  deleteSession,
  getSession,
} from '@/lib/auth'
import { getUserByEmail } from '@/lib/dal'
import { redirect } from 'next/navigation'
import {
  rateLimit,
  resetRateLimit,
  unauthenticatedRateLimitIdentities,
} from '@/lib/rate-limit'

// define zod schema for signin validation
const SignInSchema = z.object({
  email: z
    .string()
    .max(64)
    .email({ message: 'Invalid email' })
    .refine((val) => val.endsWith('@billboardsource.com'), {
      message: 'Email is not a company email',
    }),
  password: z.string().min(6, 'Password is required').max(128),
})

// define zod for signup validation
const SignUpSchema = z
  .object({
    email: z
      .string()
      .min(1, 'Email is required')
      .email('Invalid email format')
      .refine((val) => val.endsWith('@billboardsource.com'), {
        message: 'Email is not a company email',
      }),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password == data.confirmPassword, {
    message: 'password not matching',
    path: ['confirmPassword'],
  })

export type SignInData = z.infer<typeof SignInSchema>
export type SignUpData = z.infer<typeof SignUpSchema>

export type ActionResponse = {
  success: boolean
  message: string
  errors?: Record<string, string[]>
  error?: string
}

const INVALID_CREDENTIALS_RESPONSE: ActionResponse = {
  success: false,
  message: 'Invalid email or password',
  errors: { email: ['Invalid email or password'] },
}

// Cost-10 sentinel keeps unknown-account and wrong-password paths comparable.
const DUMMY_PASSWORD_HASH =
  '$2b$10$vHD9aiVqXpjS7cwiqkJdMeKa0BywYh13fscFrGo5R8YQ6lCK5a8y2'

const RATE_LIMITED_RESPONSE: ActionResponse = {
  success: false,
  message: 'Too many attempts. Please try again later.',
}

class SignInFailure extends Error {
  constructor(readonly response: ActionResponse) {
    super(response.message)
  }
}

async function enforceSignInSourceLimit() {
  const { source } = await unauthenticatedRateLimitIdentities()
  const attempt = await rateLimit('sign-in-source', source, 30, 15 * 60)
  if (!attempt.allowed) throw new SignInFailure(RATE_LIMITED_RESPONSE)
}

function parseSignInData(data: unknown): SignInData {
  const result = SignInSchema.safeParse(data)
  if (!result.success) {
    throw new SignInFailure({
      success: false,
      message: 'Signin Validation Failed',
      errors: { email: ['Invalid email or password'] },
    })
  }
  return result.data
}

async function enforceSignInAccountLimit(email: string) {
  const { account } = await unauthenticatedRateLimitIdentities(email)
  const identity = account as string
  const attempt = await rateLimit('sign-in-account', identity, 5, 15 * 60)
  if (!attempt.allowed) throw new SignInFailure(RATE_LIMITED_RESPONSE)
  return identity
}

async function authenticatePassword(data: SignInData) {
  const user = await getUserByEmail(data.email)
  if (!user) {
    await verifyPassword(data.password, DUMMY_PASSWORD_HASH)
    return null
  }
  if (!user.password) {
    await verifyPassword(data.password, DUMMY_PASSWORD_HASH)
    return null
  }
  return (await verifyPassword(data.password, user.password)) ? user : null
}

async function completeSignIn(
  user: { id: string; email: string; role: string | null },
  accountIdentity: string,
): Promise<ActionResponse> {
  await createSession(user.id, user.email, user.role ?? 'user')
  await resetRateLimit('sign-in-account', accountIdentity)
  return { success: true, message: 'Signed in successfully' }
}

export async function signIn(formData: FormData): Promise<ActionResponse> {
  try {
    // extract data from form
    const data = {
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    }

    await enforceSignInSourceLimit()
    const validatedData = parseSignInData(data)
    const accountIdentity = await enforceSignInAccountLimit(validatedData.email)

    const user = await authenticatePassword(validatedData)
    if (!user) {
      return INVALID_CREDENTIALS_RESPONSE
    }

    return completeSignIn(user, accountIdentity)
  } catch (error) {
    if (error instanceof SignInFailure) return error.response
    console.error('Sign in failed')
    return {
      success: false,
      message: 'An error occured while signing in ',
      error: 'Failed to sign in',
    }
  }
}

export async function signUp(
  prevState: ActionResponse,
  formData: FormData,
): Promise<ActionResponse> {
  try {
    const session = await getSession()
    if (session?.role !== 'admin') {
      return {
        success: false,
        message: 'Forbidden: Admin access required',
      }
    }

    // extract data from form
    const data = {
      email: formData.get('email') as string,
      password: formData.get('password') as string,
      confirmPassword: formData.get('confirmPassword') as string,
    }

    // get admin checkbox value
    const isAdmin = formData.get('isAdmin') === 'on'
    const role = isAdmin ? 'admin' : 'user'

    // get twilio phone number
    const twilioPhoneNumber = formData.get('twilioPhoneNumber') as string | null

    // validate with zod
    const validationResult = SignUpSchema.safeParse(data)
    if (!validationResult.success) {
      return {
        success: false,
        message: 'Validation error',
        errors: validationResult.error.flatten().fieldErrors,
      }
    }

    // check if user already exist
    const existingUser = await getUserByEmail(data.email)
    if (existingUser) {
      return {
        success: false,
        message: 'User with this email already exists',
        errors: {
          email: ['User with this email exist'],
        },
      }
    }

    // create new user with role and twilio phone number
    const user = await createUser(
      data.email,
      data.password,
      role,
      twilioPhoneNumber || undefined,
    )
    if (!user) {
      return {
        success: false,
        message: 'Failed to create user',
        error: 'faild to creatre user',
      }
    }

    return {
      success: true,
      message: 'Account created successfully',
    }
  } catch {
    console.error('Sign up failed')
    return {
      success: false,
      message: 'An error occured while creating your account',
      error: 'Failed to create account',
    }
  }
}

export async function signOut(): Promise<void> {
  await deleteSession()
  redirect('/login')
}
