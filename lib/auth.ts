import { compare, hash } from 'bcrypt'
import { nanoid } from 'nanoid'
import { cookies } from 'next/headers'
import { db } from '@/db'
import { user } from '@/db/schema'
import * as jose from 'jose'
import { cache } from 'react'
import { serverConfig } from '@/lib/config'
import { eq } from 'drizzle-orm'

//JWT types
interface JWTPayload {
  userId: string
  email?: string
  [key: string]: string | number | boolean | null | undefined
}

const JWT_SECRET = new TextEncoder().encode(serverConfig.auth.jwtSecret)

// A work session lasts eight and a half hours. Calls renew this window when
// accepted so their post-call Nutshell submission remains authenticated.
const JWT_EXPIRATION = '8.5h'

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
  twilioPhoneNumber?: string,
) {
  const hashedPassword = await hashPassword(password)
  const id = nanoid()

  try {
    await db.insert(user).values({
      id,
      email,
      password: hashedPassword,
      role,
      twilioPhoneNumber: twilioPhoneNumber || null,
    })
    return { id, email }
  } catch {
    console.error('Error creating user')
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
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ERR_JWT_EXPIRED'
    ) {
      console.log('🔒 Token expired - logging out')
    } else {
      console.error('JWT verification failed')
    }
    return null
  }
}

// helper to set auth cookie (SESSION COOKIE - no maxAge means it dies when browser closes)
async function setAuthCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set({
    name: 'auth_token',
    value: token,
    httpOnly: true,
    secure: serverConfig.auth.secureCookies,
    // NO maxAge - this makes it a session cookie that's deleted when browser closes
    path: '/',
    sameSite: 'lax',
  })
}

// create a session using jwt
export async function createSession(
  userId: string,
  email: string,
  role: string = 'user',
) {
  try {
    //create jwt with user data
    const token = await generateJWT({ userId, email, role })

    //store jwt in a cookie
    await setAuthCookie(token)

    return true
  } catch {
    console.error('Error creating session')
    return false
  }
}

export async function extendSessionForCall(
  session: {
    userId: string
    email: string
    role: string
    issuedAt: number
    sessionStartedAt: number
  },
  activeCallSid: string,
) {
  try {
    const token = await generateJWT({
      userId: session.userId,
      email: session.email,
      role: session.role,
      sessionStartedAt: session.sessionStartedAt,
      activeCallSid,
    })
    await setAuthCookie(token)
    return true
  } catch {
    console.error('Error extending session for call')
    return false
  }
}

/** Returns the current session without extending its lifetime. */
export const getSession = cache(async () => {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('auth_token')?.value

    if (!token) return null

    const payload = await verifyJWT(token)
    if (!payload) return null

    const [currentUser] = await db
      .select({ email: user.email, role: user.role })
      .from(user)
      .where(eq(user.id, payload.userId))
      .limit(1)
    if (!currentUser) return null

    return {
      userId: payload.userId,
      email: currentUser.email,
      role: currentUser.role || 'user',
      issuedAt: payload.iat as number,
      sessionStartedAt:
        typeof payload.sessionStartedAt === 'number'
          ? payload.sessionStartedAt
          : (payload.iat as number),
      activeCallSid:
        typeof payload.activeCallSid === 'string'
          ? payload.activeCallSid
          : undefined,
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('During prerendering, `cookies()` rejects')
    ) {
      console.log(
        'Cookies not available during prerendering, returning null session',
      )
      return null
    }
    console.error('Error getting session')
    return null
  }
})

// Retain the existing API name for background callers.
export const getSessionWithoutRefresh = getSession

// delete session by clearing the JWT cookie
export async function deleteSession() {
  const cookieStore = await cookies()
  cookieStore.delete('auth_token')
}
