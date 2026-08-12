import { createHash } from 'node:crypto'

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string'
    ? email.trim().toLowerCase().slice(0, 320)
    : ''
}

function opaqueIdentity(kind: string, value: string): string {
  return createHash('sha256').update(`${kind}\n${value}`).digest('hex')
}

export function privacySafeSourceIdentity(address: string): string {
  return opaqueIdentity('source', address.trim() || 'unknown')
}

export function privacySafeAccountIdentity(email: unknown): string | null {
  const normalized = normalizeEmail(email)
  return normalized ? opaqueIdentity('account', normalized) : null
}
