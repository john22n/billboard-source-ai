import 'server-only'

import { headers } from 'next/headers'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  privacySafeAccountIdentity,
  privacySafeSourceIdentity,
} from '@/lib/rate-limit-core'

export type RateLimitResult = {
  allowed: boolean
  retryAfterSeconds: number
}

export async function unauthenticatedRateLimitIdentities(
  email?: unknown,
): Promise<{ source: string; account: string | null }> {
  const requestHeaders = await headers()
  const forwarded = requestHeaders.get('x-forwarded-for')
  const address =
    forwarded?.split(',')[0]?.trim() ||
    requestHeaders.get('x-real-ip')?.trim() ||
    'unknown'
  return {
    source: privacySafeSourceIdentity(address),
    account: privacySafeAccountIdentity(email),
  }
}

/** Atomically consumes one request from a fixed-window bucket. */
export async function rateLimit(
  scope: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  // Scope is source-controlled and identity is either a user id or SHA-256.
  const key = `${scope}:${identity}`.slice(0, 160)
  const result = await db.execute(sql`
    INSERT INTO rate_limit_buckets (key, count, reset_at)
    VALUES (${key}, 1, NOW() + (${windowSeconds} * INTERVAL '1 second'))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rate_limit_buckets.reset_at <= NOW() THEN 1
        ELSE rate_limit_buckets.count + 1
      END,
      reset_at = CASE
        WHEN rate_limit_buckets.reset_at <= NOW()
          THEN NOW() + (${windowSeconds} * INTERVAL '1 second')
        ELSE rate_limit_buckets.reset_at
      END
    RETURNING count <= ${limit} AS allowed, reset_at
  `)
  const row = result.rows[0] as { allowed: boolean; reset_at: Date | string }
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000),
  )
  return { allowed: row.allowed, retryAfterSeconds }
}

export async function resetRateLimit(
  scope: string,
  identity: string,
): Promise<void> {
  const key = `${scope}:${identity}`.slice(0, 160)
  await db.execute(sql`DELETE FROM rate_limit_buckets WHERE key = ${key}`)
}

export async function clearExpiredRateLimits(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM rate_limit_buckets
    WHERE reset_at < NOW() - INTERVAL '1 day'
    RETURNING key
  `)
  return result.rowCount ?? result.rows.length
}
