/**
 * Simultaneous Ring Context Cache
 * 
 * Stores cellCallSid and related context by reservationSid.
 * Currently uses in-memory Map (with TTL).
 * 
 * TODO: Replace with Redis for production (supports distributed deployments):
 * - npm install redis
 * - export const redis = createClient();
 * - Modify get/set to use redis.get / redis.set
 */

interface SimringContext {
  cellCallSid: string;
  conferenceName: string;
  callerCallSid: string;
  taskSid: string;
  workspaceSid: string;
  workerSid: string;
  createdAt: number;
}

// In-memory cache with TTL
const cache = new Map<string, { data: SimringContext; expiresAt: number }>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, { expiresAt }] of cache.entries()) {
    if (expiresAt < now) {
      cache.delete(key);
    }
  }
}, 5 * 60 * 1000);

export async function storeSimringContext(
  reservationSid: string,
  data: SimringContext
): Promise<void> {
  const key = `simring:${reservationSid}`;
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
  cache.set(key, { data, expiresAt });
  console.log(`📦 Stored simring context for ${reservationSid}`);
}

export async function getSimringContext(
  reservationSid: string
): Promise<SimringContext | null> {
  const key = `simring:${reservationSid}`;
  const entry = cache.get(key);

  if (!entry) {
    console.log(`🔍 No cached simring context for ${reservationSid}`);
    return null;
  }

  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    console.log(`⏰ Simring context for ${reservationSid} expired`);
    return null;
  }

  console.log(`✅ Retrieved simring context for ${reservationSid}`);
  return entry.data;
}

export async function deleteSimringContext(
  reservationSid: string
): Promise<void> {
  const key = `simring:${reservationSid}`;
  cache.delete(key);
  console.log(`🗑️ Deleted simring context for ${reservationSid}`);
}

export function getCacheStats(): {
  size: number;
  keys: string[];
} {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}
