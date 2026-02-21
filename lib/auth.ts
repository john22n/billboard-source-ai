import { compare, hash } from 'bcrypt'
import { nanoid } from 'nanoid'
import { cookies } from 'next/headers'
import { db } from '@/db'
import { user } from '@/db/schema'
import * as jose from 'jose'
import { cache } from 'react'

//JWT types
interface JWTPayload {
  userId: string
  email?: string
  [key: string]: string | number | boolean | null | undefined
}

// secret key for JWT signing (in a real app, use env variables)
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-min-32-chars-long'
)

// JWT expiration - 4 hours of inactivity will log user out
const JWT_EXPIRATION = '20h'

// token refresh threshold - refresh if token expires within this time
// This keeps active users logged in by refreshing before expiration
const REFRESH_THRESHOLD = 60 * 60 // 1 hour in seconds

// hash a password
export async function hashPassword(password: string) {
  return hash(password, 10)
}

//verify password
export async function verifyPassword(password: string, hashedPassword: string) {
  return compare(password, hashedPassword)
}

// create a new user
export async function createUser(
  email: string,
  password: string,
  role: string = 'user',
  twilioPhoneNumber?: string
) {
  const hashedPassword = await hashPassword(password)
  const id = nanoid()
  console.log(id)

  try {
    await db.insert(user).values({
      id,
      email,
      password: hashedPassword,
      role,
      twilioPhoneNumber: twilioPhoneNumber || null,
    })
    return { id, email }
  } catch (error) {
    console.error('error creating user:', error)
    return null
  }
}

//generate a jwt token
export async function generateJWT(payload: JWTPayload) {
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRATION)
    .sign(JWT_SECRET)
}

//verify jwt token
export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET)
    return payload as JWTPayload
  } catch (error: unknown) {
    // Check if it's an expired token error
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_JWT_EXPIRED') {
      // Extract user email from the expired token's payload
      const expiredPayload = 'payload' in error ? error.payload as JWTPayload : null
      const userEmail = expiredPayload?.email || 'unknown'
      console.log(`🔒 Token expired for user: ${userEmail} - logging out`)
    } else {
      console.error('JWT verification failed:', error)
    }
    return null
  }
}

// check if token needs refreshing
export async function shouldRefreshToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET, {
      clockTolerance: 15, // tolerance for clock skew
    })

    // get expiration time
    const exp = payload.exp as number
    const now = Math.floor(Date.now() / 1000)

    // if token expires within threshold, refresh it
    return exp - now < REFRESH_THRESHOLD
  } catch {
    return false
  }
}

// helper to set auth cookie (SESSION COOKIE - no maxAge means it dies when browser closes)
async function setAuthCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set({
    name: 'auth_token',
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // NO maxAge - this makes it a session cookie that's deleted when browser closes
    path: '/',
    sameSite: 'lax',
  })
}

// create a session using jwt
export async function createSession(userId: string, email: string, role: string = 'user') {
  try {
    //create jwt with user data
    const token = await generateJWT({ userId, email, role })

    //store jwt in a cookie
    await setAuthCookie(token)

    return true
  } catch (error) {
    console.error('Error creating session:', error)
    return false
  }
}

/**
 * Get current session WITHOUT refreshing the token
 * Use this for SSE endpoints and background checks that shouldn't extend the session
 */
export const getSessionWithoutRefresh = cache(async () => {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('auth_token')?.value

    if (!token) return null

    const payload = await verifyJWT(token)
    if (!payload) return null

    return { userId: payload.userId, email: payload.email as string, role: (payload.role as string) || 'user' }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('During prerendering, `cookies()` rejects')
    ) {
      console.log('Cookies not available during prerendering, returning null session')
      return null
    }
    console.error('Error getting session:', error)
    return null
  }
})

/**
 * Get current session WITH auto-refresh
 * Use this for user-initiated actions (form submissions, page loads, API calls)
 * This keeps active users logged in by refreshing tokens before they expire
 */
export const getSession = cache(async () => {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('auth_token')?.value

    if (!token) return null

    const payload = await verifyJWT(token)
    if (!payload) return null

    // Auto-refresh token if it's getting close to expiration
    // This keeps active users logged in during working hours
    try {
      if (await shouldRefreshToken(token)) {
        const newToken = await generateJWT({
          userId: payload.userId,
          email: payload.email as string,
          role: (payload.role as string) || 'user',
        })
        await setAuthCookie(newToken)
        console.log('🔄 Session token auto-refreshed for user:', payload.userId)
      }
    } catch (refreshError) {
      // If refresh fails, still return the valid session
      // The user will just need to login when the token eventually expires
      console.error('Token refresh failed (non-fatal):', refreshError)
    }

    return { userId: payload.userId, email: payload.email as string, role: (payload.role as string) || 'user' }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('During prerendering, `cookies()` rejects')
    ) {
      console.log('Cookies not available during prerendering, returning null session')
      return null
    }
    console.error('Error getting session:', error)
    return null
  }
})

// delete session by clearing the JWT cookie
export async function deleteSession() {
  const cookieStore = await cookies()
  cookieStore.delete('auth_token')
}