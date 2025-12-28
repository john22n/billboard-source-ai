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
  [key: string]: string | number | boolean | null | undefined
}

// secret key for JWT signing ( in a real app, use env variables)
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-min-32-chars-long'
)

// JWT experation
const JWT_EXPIRATION = '2d' // 1 day

// token refresh threshold
const REFRESH_THRESHOLD = 24 * 60 * 60 // 24 hours in seconds

// hash a password
export async function hashPassword(password: string) {
  return hash(password, 10)
}
//verify password
export async function verifyPassword(password: string, hashedPassword: string) {
  return compare(password, hashedPassword)
}
// create a new user
export async function createUser(email: string, password: string, role: string = 'user', twilioPhoneNumber?: string) {
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
    console.error("error createing user:", error)
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
  } catch (error) {
    console.error('JWT verifcation failed:', error)
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

// create a session using jwt
export async function createSession(userId: string, email: string) {
  try {
    //create jwt with user data
    const token = await generateJWT({ userId, email })

    //store jwt in a cookie
    const cookieStore = await cookies()
    cookieStore.set({
      name: 'auth_token',
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 2, // 2 days
      path: '/',
      sameSite: 'lax'
    })
    return true
  } catch (error) {
    console.error('Error creating session:', error)
    return false
  }
}

// get current session from jwt
export const getSession = cache(async () => {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('auth_token')?.value

    if (!token) return null
    const payload = await verifyJWT(token)
    return payload ? { userId: payload.userId, email: payload.email as string } : null
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('During prerendering, `cookies()` rejects')
    ) {
      console.log('Cookies not available during prerendering, returning null session')
      return null
    }
  }
})

// delete session by clearing the JWT cookie
export async function deleteSession() {
  const cookieStore = await cookies()
  cookieStore.delete('auth_token')
}
