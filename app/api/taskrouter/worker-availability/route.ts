/**
 * Worker Availability API
 *
 * Admin-only endpoint that returns each Sales Rep's Average Workday Hours:
 * the average time spent in the "Available" activity during Monday–Friday
 * workdays in Central Time, excluding weekend availability (the company is
 * closed on weekends).
 *
 * Twilio's cumulative worker statistics only return a single aggregate total
 * over a window and cannot split weekday vs weekend hours. So we fetch
 * statistics per Central-Time calendar day over the lookback window, sum the
 * Available seconds for weekdays only, and divide by the number of weekdays.
 *
 * This is an admin-only metric. It does NOT affect call routing or
 * business-hours eligibility behavior.
 *
 * Lists workers directly from Twilio TaskRouter and matches them to DB
 * users by email (friendlyName), avoiding stale worker SID issues.
 */

import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { getSession } from '@/lib/auth'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!

const PERIOD_DAYS = 28 // Twilio retains 30 days max; use 28 to stay safely within limits
const TIME_ZONE = 'America/Chicago' // Central Time, DST-aware

const client = twilio(ACCOUNT_SID, AUTH_TOKEN)

// In-memory cache: store result + timestamp, refresh once per day
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
let cachedResponse: { data: unknown; fetchedAt: number } | null = null

// Offset (ms) between the given timezone's wall-clock and UTC at a moment.
// Positive when the zone is ahead of UTC; Central Time is negative.
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUTC - date.getTime()
}

// The Y/M/D calendar date in the target timezone for a given instant.
function tzDateParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  }
}

// UTC instant corresponding to midnight (00:00) on a given wall-clock date in
// the target timezone.
function zonedMidnightUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0)
  const offset = tzOffsetMs(new Date(guess), timeZone)
  return new Date(guess - offset)
}

// Build the list of Central-Time calendar days in the lookback window, each
// with its UTC start/end bounds and whether it is a Mon–Fri workday.
function buildWorkdayWindows() {
  const today = tzDateParts(new Date(), TIME_ZONE)
  const todayMidnight = zonedMidnightUtc(
    today.year,
    today.month,
    today.day,
    TIME_ZONE,
  )

  const windows: { start: Date; end: Date; isWeekday: boolean }[] = []

  // Cover the previous PERIOD_DAYS full Central-Time days (excludes today,
  // which is still in progress).
  for (let i = 1; i <= PERIOD_DAYS; i++) {
    // Step back ~i days from today's midnight, then re-derive the exact CT
    // calendar date and midnight so DST transitions self-correct.
    const approx = new Date(todayMidnight.getTime() - i * 24 * 60 * 60 * 1000)
    const parts = tzDateParts(approx, TIME_ZONE)
    const start = zonedMidnightUtc(
      parts.year,
      parts.month,
      parts.day,
      TIME_ZONE,
    )
    const next = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const end = zonedMidnightUtc(
      tzDateParts(next, TIME_ZONE).year,
      tzDateParts(next, TIME_ZONE).month,
      tzDateParts(next, TIME_ZONE).day,
      TIME_ZONE,
    )

    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      weekday: 'short',
    }).format(start)
    const isWeekday = !(weekday === 'Sat' || weekday === 'Sun')

    windows.push({ start, end, isWeekday })
  }

  return windows
}

async function fetchAvailability() {
  // Get all DB users to map emails → user IDs
  const dbUsers = await db.select({ id: user.id, email: user.email }).from(user)

  const emailToUserId: Record<string, string> = {}
  for (const u of dbUsers) {
    emailToUserId[u.email.toLowerCase()] = u.id
  }

  // List all workers directly from TaskRouter (source of truth)
  const twilioWorkers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list()

  console.log(`📊 Found ${twilioWorkers.length} TaskRouter workers`)

  const windows = buildWorkdayWindows()
  const weekdayWindows = windows.filter((w) => w.isWeekday)
  const workdayCount = weekdayWindows.length

  // Fetch statistics for each worker, per weekday window, summing only the
  // "Available" seconds that fall on Mon–Fri Central-Time days.
  const results = await Promise.allSettled(
    twilioWorkers.map(async (worker) => {
      const perDaySeconds = await Promise.all(
        weekdayWindows.map(async (win) => {
          const stats = await client.taskrouter.v1
            .workspaces(WORKSPACE_SID)
            .workers(worker.sid)
            .statistics()
            .fetch({ startDate: win.start, endDate: win.end })

          const cumulative = stats.cumulative as Record<string, unknown>
          const activityDurations = cumulative?.activity_durations as
            | Array<{ friendly_name: string; total: number }>
            | undefined

          const availableEntry = activityDurations?.find(
            (entry) => entry.friendly_name.toLowerCase() === 'available',
          )
          return availableEntry?.total ?? 0
        }),
      )

      const totalWorkdaySeconds = perDaySeconds.reduce((a, b) => a + b, 0)
      const totalWorkdayHours =
        Math.round((totalWorkdaySeconds / 3600) * 10) / 10
      const avgWorkdayHours =
        workdayCount > 0
          ? Math.round((totalWorkdaySeconds / workdayCount / 3600) * 10) / 10
          : 0

      // Match worker to DB user by friendlyName (email)
      const userId = emailToUserId[worker.friendlyName.toLowerCase()]

      return {
        userId,
        workerEmail: worker.friendlyName,
        workerSid: worker.sid,
        avgWorkdayHours,
        totalWorkdayHours,
      }
    }),
  )

  // Build the response
  const availability: Record<
    string,
    {
      avgWorkdayHours: number
      totalWorkdayHours: number
      avgDailyHours: number
    }
  > = {}

  const errors: string[] = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { userId, avgWorkdayHours, totalWorkdayHours } = result.value
      if (userId) {
        availability[userId] = {
          avgWorkdayHours,
          totalWorkdayHours,
          // Backward-compatible alias for existing clients.
          avgDailyHours: avgWorkdayHours,
        }
      }
    } else {
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      console.error('❌ Worker stats fetch failed:', reason)
      errors.push(reason)
    }
  }

  console.log(
    `📊 Returning Average Workday Hours for ${Object.keys(availability).length}/${twilioWorkers.length} workers (${workdayCount} weekdays)`,
  )

  return {
    availability,
    periodDays: PERIOD_DAYS,
    workdayCount,
    _debug: {
      twilioWorkersFound: twilioWorkers.length,
      workers: twilioWorkers.map((w) => ({
        name: w.friendlyName,
        sid: w.sid,
        matched: !!emailToUserId[w.friendlyName.toLowerCase()],
      })),
      fulfilled: Object.keys(availability).length,
      errors,
    },
  }
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (session.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Return cached data if still fresh (within 24 hours)
    if (
      cachedResponse &&
      Date.now() - cachedResponse.fetchedAt < CACHE_TTL_MS
    ) {
      console.log('📊 Returning cached worker availability')
      return Response.json(cachedResponse.data)
    }

    const data = await fetchAvailability()
    cachedResponse = { data, fetchedAt: Date.now() }

    return Response.json(data)
  } catch (error) {
    console.error('❌ Worker availability error:', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
