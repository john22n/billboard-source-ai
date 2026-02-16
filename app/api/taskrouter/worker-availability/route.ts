/**
 * Worker Availability API
 *
 * Admin-only endpoint that fetches per-worker availability statistics
 * from TaskRouter over the last 30 days and returns average daily hours
 * each worker spent in the "Available" activity.
 *
 * Lists workers directly from Twilio TaskRouter and matches them to DB
 * users by email (friendlyName), avoiding stale worker SID issues.
 */

import twilio from 'twilio';
import { db } from '@/db';
import { user } from '@/db/schema';
import { getSession } from '@/lib/auth';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const PERIOD_DAYS = 28; // Twilio retains 30 days max; use 28 to stay safely within limits

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

// In-memory cache: store result + timestamp, refresh once per day
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let cachedResponse: { data: unknown; fetchedAt: number } | null = null;

async function fetchAvailability() {
  // Get all DB users to map emails → user IDs
  const dbUsers = await db
    .select({ id: user.id, email: user.email })
    .from(user);

  const emailToUserId: Record<string, string> = {};
  for (const u of dbUsers) {
    emailToUserId[u.email.toLowerCase()] = u.id;
  }

  // List all workers directly from TaskRouter (source of truth)
  const twilioWorkers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list();

  console.log(`📊 Found ${twilioWorkers.length} TaskRouter workers`);

  // Use minutes param (28 days = 40320 minutes)
  const periodMinutes = PERIOD_DAYS * 24 * 60;

  // Fetch statistics for each worker in parallel
  const results = await Promise.allSettled(
    twilioWorkers.map(async (worker) => {
      const stats = await client.taskrouter.v1
        .workspaces(WORKSPACE_SID)
        .workers(worker.sid)
        .statistics()
        .fetch({ minutes: periodMinutes });

      const cumulative = stats.cumulative as Record<string, unknown>;

      const activityDurations = cumulative?.activity_durations as
        | Array<{ friendly_name: string; total: number }>
        | undefined;

      // Find the "Available" activity duration
      const availableEntry = activityDurations?.find(
        (entry) => entry.friendly_name.toLowerCase() === 'available'
      );

      const totalAvailableSeconds = availableEntry?.total ?? 0;
      const totalHours =
        Math.round((totalAvailableSeconds / 3600) * 10) / 10;
      const avgDailyHours =
        Math.round((totalAvailableSeconds / PERIOD_DAYS / 3600) * 10) / 10;

      // Match worker to DB user by friendlyName (email)
      const userId = emailToUserId[worker.friendlyName.toLowerCase()];

      return {
        userId,
        workerEmail: worker.friendlyName,
        workerSid: worker.sid,
        avgDailyHours,
        totalHours,
      };
    })
  );

  // Build the response
  const availability: Record<
    string,
    { avgDailyHours: number; totalHours: number }
  > = {};

  const errors: string[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { userId, avgDailyHours, totalHours } = result.value;
      if (userId) {
        availability[userId] = { avgDailyHours, totalHours };
      }
    } else {
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.error('❌ Worker stats fetch failed:', reason);
      errors.push(reason);
    }
  }

  console.log(
    `📊 Returning availability for ${Object.keys(availability).length}/${twilioWorkers.length} workers`
  );

  return {
    availability,
    periodDays: PERIOD_DAYS,
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
  };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (session.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Return cached data if still fresh (within 24 hours)
    if (cachedResponse && Date.now() - cachedResponse.fetchedAt < CACHE_TTL_MS) {
      console.log('📊 Returning cached worker availability');
      return Response.json(cachedResponse.data);
    }

    const data = await fetchAvailability();
    cachedResponse = { data, fetchedAt: Date.now() };

    return Response.json(data);
  } catch (error) {
    console.error('❌ Worker availability error:', error);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
