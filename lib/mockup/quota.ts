import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

export function denverDay(now: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** One row per user. Pending work occupies the sole in-flight slot, even across midnight. */
export async function reserveImage(userId: string, now = new Date()) {
  const { db } = await import('@/db')
  const token = randomUUID()
  const day = denverDay(now)
  // Exceeds the route's 240s hard lifetime and the provider's 180s timeout.
  // An expired reservation represents a crashed function, not a delivered image.
  const until = new Date(now.getTime() + 300_000).toISOString()
  const result = await db.execute(sql`
    INSERT INTO mockup_quotas (user_id, day, successes, reservation, reserved_until)
    VALUES (${userId}, ${day}, 0, ${token}, ${until}::timestamptz)
    ON CONFLICT (user_id) DO UPDATE SET
      day = ${day},
      successes = CASE WHEN mockup_quotas.day = ${day} THEN mockup_quotas.successes ELSE 0 END,
      reservation = ${token}, reserved_until = ${until}::timestamptz
    WHERE (mockup_quotas.reservation IS NULL OR mockup_quotas.reserved_until <= ${now.toISOString()}::timestamptz)
      AND (mockup_quotas.day <> ${day} OR mockup_quotas.successes < 10)
    RETURNING successes
  `)
  if (!result.rows.length)
    throw new Error(
      'Another mockup is generating, or today’s 10-image limit has been reached. The limit resets at midnight America/Denver.',
    )
  return { token, remaining: 9 - Number(result.rows[0].successes) }
}

export async function settleImage(
  userId: string,
  token: string,
  usable: boolean,
) {
  const { db } = await import('@/db')
  const result = await db.execute(sql`
    UPDATE mockup_quotas SET successes = successes + ${usable ? 1 : 0}, reservation = NULL, reserved_until = NULL
    WHERE user_id = ${userId} AND reservation = ${token}
    RETURNING successes
  `)
  if (!result.rows.length)
    throw new Error('Image reservation expired. Please try again.')
}
