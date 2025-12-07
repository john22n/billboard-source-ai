import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticatorTransportFuture,
  CredentialDeviceType,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types'
import { db } from '@/db'
import { passkey, user } from '@/db/schema'
import { eq } from 'drizzle-orm'

// ============================================
// Configuration
// ============================================

// Relying Party (RP) configuration
// In production, these should come from environment variables
const rpName = 'Billboard Source'
const rpID = process.env.PASSKEY_RP_ID || 'localhost'
const origin = process.env.PASSKEY_ORIGIN || `http://${rpID}:3000`

// For production, you'd set:
// PASSKEY_RP_ID=yourdomain.com
// PASSKEY_ORIGIN=https://yourdomain.com

// ============================================
// Types
// ============================================

export interface StoredPasskey {
  id: string
  viserId: string
  credentialId: string // Base64URL encoded
  publicKey: string // Base64 encoded
  counter: number
  deviceType: CredentialDeviceType | null
  transports: AuthenticatorTransportFuture[] | null
  name: string
  createdAt: Date
}

// ============================================
// Database Helpers
// ============================================

/**
 * Get all passkeys for a user
 */
export async function getPasskeysByUserId(userId: string): Promise<StoredPasskey[]> {
  const passkeys = await db
    .select()
    .from(passkey)
    .where(eq(passkey.userId, userId))

  return passkeys.map((p) => ({
    id: p.id,
    viserId: p.userId,
    credentialId: p.credentialId,
    publicKey: p.publicKey,
    counter: p.counter,
    deviceType: p.deviceType as CredentialDeviceType | null,
    transports: p.transports ? JSON.parse(p.transports) : null,
    name: p.name || 'Passkey',
    createdAt: p.createdAt,
  }))
}

/**
 * Get a passkey by credential ID
 */
export async function getPasskeyByCredentialId(credentialId: string): Promise<StoredPasskey | null> {
  const [p] = await db
    .select()
    .from(passkey)
    .where(eq(passkey.credentialId, credentialId))
    .limit(1)

  if (!p) return null

  return {
    id: p.id,
    viserId: p.userId,
    credentialId: p.credentialId,
    publicKey: p.publicKey,
    counter: p.counter,
    deviceType: p.deviceType as CredentialDeviceType | null,
    transports: p.transports ? JSON.parse(p.transports) : null,
    name: p.name || 'Passkey',
    createdAt: p.createdAt,
  }
}

/**
 * Get user by email (for passkey authentication)
 */
export async function getUserByEmail(email: string) {
  const [u] = await db
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  return u || null
}

/**
 * Save a new passkey to the database
 */
export async function savePasskey(data: {
  id: string
  userId: string
  credentialId: string
  publicKey: string
  counter: number
  deviceType?: string
  transports?: string[]
  name?: string
}) {
  await db.insert(passkey).values({
    id: data.id,
    userId: data.userId,
    credentialId: data.credentialId,
    publicKey: data.publicKey,
    counter: data.counter,
    deviceType: data.deviceType || null,
    transports: data.transports ? JSON.stringify(data.transports) : null,
    name: data.name || 'Passkey',
  })
}

/**
 * Update passkey counter after successful authentication
 */
export async function updatePasskeyCounter(credentialId: string, newCounter: number) {
  await db
    .update(passkey)
    .set({ counter: newCounter })
    .where(eq(passkey.credentialId, credentialId))
}

/**
 * Delete a passkey
 */
export async function deletePasskey(passkeyId: string) {
  await db
    .delete(passkey)
    .where(eq(passkey.id, passkeyId))
}

// ============================================
// Registration (Creating a new passkey)
// ============================================

/**
 * Generate options for registering a new passkey
 */
export async function generatePasskeyRegistrationOptions(
  userId: string,
  userEmail: string
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  // Get existing passkeys to exclude them
  const existingPasskeys = await getPasskeysByUserId(userId)

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: userEmail,
    userDisplayName: userEmail.split('@')[0],
    // Don't prompt user for additional info
    attestationType: 'none',
    // Prevent re-registration of existing authenticators
    excludeCredentials: existingPasskeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports || undefined,
    })),
    authenticatorSelection: {
      // Prefer platform authenticators (Face ID, Touch ID, Windows Hello)
      // but allow security keys too
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  return options
}

/**
 * Verify a registration response and save the passkey
 */
export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  passkeyName?: string
): Promise<VerifiedRegistrationResponse> {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  })

  if (verification.verified && verification.registrationInfo) {
    const { credential, credentialDeviceType } = verification.registrationInfo

    // Generate a UUID for the passkey record
    const passkeyId = crypto.randomUUID()

    // Save to database
    await savePasskey({
      id: passkeyId,
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      deviceType: credentialDeviceType,
      transports: response.response.transports,
      name: passkeyName || 'Passkey',
    })
  }

  return verification
}

// ============================================
// Authentication (Signing in with a passkey)
// ============================================

/**
 * Generate options for authenticating with a passkey
 * If email is provided, only allow that user's passkeys
 * Otherwise, allow any discoverable passkey (usernameless login)
 */
export async function generatePasskeyAuthenticationOptions(
  email?: string
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined

  if (email) {
    const u = await getUserByEmail(email)
    if (u) {
      const userPasskeys = await getPasskeysByUserId(u.id)
      allowCredentials = userPasskeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports || undefined,
      }))
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    // If no email provided, don't restrict to specific credentials
    // This enables "usernameless" authentication with discoverable credentials
    allowCredentials,
  })

  return options
}

/**
 * Verify an authentication response
 */
export async function verifyPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string
): Promise<{ verification: VerifiedAuthenticationResponse; userId: string } | null> {
  // Find the passkey by credential ID
  const storedPasskey = await getPasskeyByCredentialId(response.id)

  if (!storedPasskey) {
    return null
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: storedPasskey.credentialId,
      publicKey: Buffer.from(storedPasskey.publicKey, 'base64'),
      counter: storedPasskey.counter,
      transports: storedPasskey.transports || undefined,
    },
  })

  if (verification.verified) {
    // Update counter to prevent replay attacks
    await updatePasskeyCounter(
      storedPasskey.credentialId,
      verification.authenticationInfo.newCounter
    )
  }

  // Get the userId from the passkey to identify who logged in
  const [p] = await db
    .select({ userId: passkey.userId })
    .from(passkey)
    .where(eq(passkey.credentialId, response.id))
    .limit(1)

  return {
    verification,
    userId: p?.userId || storedPasskey.viserId,
  }
}

// ============================================
// Exports for configuration (used by API routes)
// ============================================

export const passkeyConfig = {
  rpName,
  rpID,
  origin,
}
