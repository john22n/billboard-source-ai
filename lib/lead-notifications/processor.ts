import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm'
import { serverConfig, type ServerConfig } from '@/lib/config'
import { leadNotifications, nutshellWebhookInbox, user } from '@/db/schema'
import { hydrateLead } from './hydrate'

type Database = typeof import('@/db').db
type InboxEntry = typeof nutshellWebhookInbox.$inferSelect
type Notification = typeof leadNotifications.$inferSelect
type ProcessingOutcome = {
  status: 'pending' | 'excluded' | 'processed'
  reason: string | null
}
type ProcessingContext = {
  config: ServerConfig
  cutoff: Date
  deadline: number
  fetcher?: typeof fetch
}

async function claimInboxEntry(
  db: Database,
  id: number,
  due: ReturnType<typeof and>,
) {
  // Atomic lease; an interrupted invocation becomes due again automatically.
  const [claimed] = await db
    .update(nutshellWebhookInbox)
    .set({
      nextAttemptAt: new Date(Date.now() + 60_000),
      attempts: sql`${nutshellWebhookInbox.attempts} + 1`,
    })
    .where(and(due, eq(nutshellWebhookInbox.id, id)))
    .returning()
  return claimed
}

async function deliverSnapshot(
  db: Database,
  snapshot: Notification,
  allowlist: string[],
): Promise<ProcessingOutcome> {
  if (snapshot.recipientId || snapshot.clearedAt)
    return { status: 'processed', reason: null }
  if (allowlist.length > 0 && !allowlist.includes(snapshot.assigneeEmail))
    return { status: 'pending', reason: 'recipient_not_allowlisted' }
  const matches = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(trim(${user.email})) = ${snapshot.assigneeEmail}`)
    .limit(2)
  if (matches.length !== 1)
    return {
      status: 'pending',
      reason: matches.length
        ? 'app_identity_ambiguous'
        : 'app_identity_unmatched',
    }
  await db
    .update(leadNotifications)
    .set({ recipientId: matches[0].id, createdAt: new Date() })
    .where(
      and(
        eq(leadNotifications.id, snapshot.id),
        isNull(leadNotifications.recipientId),
        isNull(leadNotifications.clearedAt),
      ),
    )
  return { status: 'processed', reason: null }
}

async function processClaimedLead(
  db: Database,
  leadId: string,
  context: ProcessingContext,
): Promise<ProcessingOutcome> {
  const { config, cutoff, deadline, fetcher } = context
  const settings = config.leadNotifications
  let [snapshot] = await db
    .select()
    .from(leadNotifications)
    .where(eq(leadNotifications.id, leadId))
  if (!snapshot) {
    const result = await hydrateLead(leadId, {
      cutoff,
      email: settings.integrationEmail,
      apiKey: config.nutshell.requireApiKey(),
      fetcher,
      signal: AbortSignal.timeout(
        Math.max(1, Math.min(8000, deadline - Date.now())),
      ),
    })
    if (result.status !== 'eligible') return result
    // Freeze CRM identity before matching an app account. A later retry cannot
    // replace an unmatched initial recipient with a later owner. Read back the
    // winning snapshot after a concurrent insert; never deliver our losing one.
    await db
      .insert(leadNotifications)
      .values({
        id: leadId,
        assigneeId: result.assigneeId,
        assigneeEmail: result.assigneeEmail,
        assignmentEventId: result.assignmentEventId,
        companyName: result.companyName,
        leadUrl: result.leadUrl,
        leadCreatedAt: result.leadCreatedAt,
      })
      .onConflictDoNothing()
    ;[snapshot] = await db
      .select()
      .from(leadNotifications)
      .where(eq(leadNotifications.id, leadId))
  }
  if (!snapshot) return { status: 'pending', reason: null }
  return deliverSnapshot(db, snapshot, settings.recipientAllowlist)
}

async function recordProcessingOutcome(
  db: Database,
  claimed: InboxEntry,
  outcome: ProcessingOutcome,
) {
  await db
    .update(nutshellWebhookInbox)
    .set({
      status: outcome.status,
      lastReason: outcome.reason,
      nextAttemptAt: new Date(
        Date.now() +
          Math.min(900_000, 15_000 * 2 ** Math.min(claimed.attempts - 1, 6)),
      ),
    })
    .where(
      and(
        eq(nutshellWebhookInbox.id, claimed.id),
        eq(nutshellWebhookInbox.attempts, claimed.attempts),
      ),
    )
}

/** Production entry point; fetcher is the integration seam for isolated DB tests.
 * No alternative URLs, fixture endpoints, or simulation flags exist in routes.
 */
export async function processLeadNotifications(
  options: {
    config?: ServerConfig
    fetcher?: typeof fetch
  } = {},
) {
  const config = options.config ?? serverConfig
  const settings = config.leadNotifications
  const cutoff = settings.launchCutoff
  if (!settings.enabled || !cutoff) return { enabled: false, processed: 0 }
  const { db } = await import('@/db')
  const deadline = Date.now() + 20_000
  const due = and(
    eq(nutshellWebhookInbox.status, 'pending'),
    lte(nutshellWebhookInbox.nextAttemptAt, new Date()),
  )
  const candidates = await db
    .select()
    .from(nutshellWebhookInbox)
    .where(due)
    .orderBy(
      asc(nutshellWebhookInbox.nextAttemptAt),
      asc(nutshellWebhookInbox.id),
    )
    .limit(10)
  let processed = 0
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break
    const claimed = await claimInboxEntry(db, candidate.id, due)
    if (!claimed) continue
    let outcome: ProcessingOutcome
    try {
      outcome = await processClaimedLead(db, claimed.leadId, {
        config,
        cutoff,
        deadline,
        fetcher: options.fetcher,
      })
    } catch {
      // No raw CRM payloads, email addresses, request URLs, or DB bind values.
      outcome = { status: 'pending', reason: 'processing_unavailable' }
    }
    await recordProcessingOutcome(db, claimed, outcome)
    processed++
  }
  return { enabled: true, processed }
}
