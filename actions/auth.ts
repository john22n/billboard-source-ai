'use server'

import { z } from 'zod'
import { verifyPassword, createSession, createUser, deleteSession, getSession } from '@/lib/auth'
import { getUserByEmail } from '@/lib/dal'
import { redirect } from 'next/navigation'
import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { eq } from 'drizzle-orm'

// define zod schema for signin validation
const SignInSchema = z.object({
  email: z.string().email({ message: 'Invalid email' })
    .refine((val) => val.endsWith('@billboardsource.com'), {
      message: 'Email is not a company email'
    }),
  password: z.string().min(6, 'Password is required')
})

// define zod for signup validation
const SignUpSchema = z
  .object({
    email: z.string().min(1, 'Email is required').email('Invalid email format')
      .refine((val) => val.endsWith('@billboardsource.com'), {
        message: 'Email is not a company email'
      }),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  }).refine((data) => data.password == data.confirmPassword, {
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

export async function signIn(formData: FormData): Promise<ActionResponse> {
  try {
    // extract data from form
    const data = {
      email: formData.get('email') as string,
      password: formData.get('password') as string
    }

    //validate with zod
    const validationResult = SignInSchema.safeParse(data)
    if (!validationResult.success) {
      return {
        success: false,
        message: 'Signin Validation Failed',
        errors: {
          email: ['Invalid email or password']
        },
      }
    }

    //find user by email
    const user = await getUserByEmail(data.email)
    if (!user) {
      return {
        success: false,
        message: 'Invalid email or password',
        errors: {
          email: ['Invalid email or password']
        },
      }
    }

    //verify password
    if (!user.password) {
      return {
        success: false,
        message: "Invalid credentials"
      }
    }

    const isPasswordValid = await verifyPassword(data.password, user.password)
    if (!isPasswordValid) {
      return {
        success: false,
        message: "Invalid credentials"
      }
    }

    //create session
    await createSession(user.id, user.email)
    return {
      success: true,
      message: 'Signed in successfully'
    }
  } catch (error) {
    console.error('sign in error:', error)
    return {
      success: false,
      message: 'An error occured while signing in ',
      error: 'Failed to sign in'
    }
  }
}

export async function signUp(prevState: ActionResponse, formData: FormData): Promise<ActionResponse> {
  try {
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
          email: ['User with this email exist']
        },
      }
    }

    // create new user with role and twilio phone number
    const user = await createUser(data.email, data.password, role, twilioPhoneNumber || undefined)
    if (!user) {
      return {
        success: false,
        message: 'Failed to create user',
        error: 'faild to creatre user'
      }
    }

    await createSession(user.id, user.email)
    return {
      success: true,
      message: 'Account created successfully'
    }
  } catch (error) {
    console.error('sign up error:', error)
    return {
      success: false,
      message: 'An error occured while creating your account',
      error: 'Failed to create account'
    }
  }
}

export async function signOut(): Promise<void> {
  try {
    const session = await getSession()
    
    if (session) {
      const currentUser = await db
        .select({
          id: user.id,
          email: user.email,
          taskRouterWorkerSid: user.taskRouterWorkerSid,
          twilioPhoneNumber: user.twilioPhoneNumber,
        })
        .from(user)
        .where(eq(user.id, session.userId))
        .limit(1)
        .then(rows => rows[0])

      if (currentUser?.taskRouterWorkerSid) {
        const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
        const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
        const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID
        const OFFLINE_ACTIVITY_SID = process.env.TASKROUTER_ACTIVITY_OFFLINE_SID

        if (ACCOUNT_SID && AUTH_TOKEN && WORKSPACE_SID && OFFLINE_ACTIVITY_SID) {
          const client = twilio(ACCOUNT_SID, AUTH_TOKEN)
          
          await client.taskrouter.v1
            .workspaces(WORKSPACE_SID)
            .workers(currentUser.taskRouterWorkerSid)
            .update({
              activitySid: OFFLINE_ACTIVITY_SID,
              attributes: JSON.stringify({
                email: currentUser.email,
                contact_uri: `client:${currentUser.email}`,
                phoneNumber: currentUser.twilioPhoneNumber,
                available: false,
              }),
            })

          await db
            .update(user)
            .set({ workerActivity: 'offline' })
            .where(eq(user.id, currentUser.id))

          console.log(`✅ Worker ${currentUser.email} set to offline on logout`)
        }
      }
    }
  } catch (error) {
    console.error('Error setting worker offline during logout:', error)
  }
  
  await deleteSession()
  redirect('/login')
}
