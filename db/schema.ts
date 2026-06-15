import { InferSelectModel, relations } from 'drizzle-orm'
import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  numeric,
  index,
  varchar,
  vector,
  unique,
} from 'drizzle-orm/pg-core'

// Your existing tables
export const user = pgTable(
  'User',
  {
    id: varchar('id', { length: 21 }).primaryKey().notNull(),
    email: varchar('email', { length: 64 }).notNull(),
    password: varchar('password', { length: 64 }),
    role: varchar('role', { length: 20 }).default('user'),
    twilioPhoneNumber: varchar('twilio_phone_number', { length: 20 }),
    taskRouterWorkerSid: varchar('taskrouter_worker_sid', { length: 34 }),
    workerActivity: varchar('worker_activity', { length: 20 }).default(
      'offline',
    ),
  },
  (table) => ({
    // A Sales Rep Number belongs to exactly one Sales Rep. Enforced so the
    // terminal Overflow Number can be unambiguously attributed (Feature 2).
    twilioPhoneUnique: unique('user_twilio_phone_number_unique').on(
      table.twilioPhoneNumber,
    ),
  }),
)

export type User = InferSelectModel<typeof user>

// Passkey credentials for WebAuthn authentication
export const passkey = pgTable('Passkey', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(), // UUID
  userId: varchar('user_id', { length: 21 })
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(), // Base64 encoded credential ID
  publicKey: text('public_key').notNull(), // Base64 encoded public key
  counter: integer('counter').notNull().default(0), // Signature counter for replay prevention
  deviceType: varchar('device_type', { length: 32 }), // 'platform' or 'cross-platform'
  transports: text('transports'), // JSON array: ['internal', 'usb', 'ble', 'nfc']
  name: varchar('name', { length: 64 }).default('Passkey'), // User-friendly name
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type Passkey = InferSelectModel<typeof passkey>

export const openaiLogs = pgTable('openai_logs', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  totalTokens: integer('total_tokens').notNull(),
  cost: numeric('cost', { precision: 10, scale: 6 }).notNull(),
  sessionId: text('session_id'),
  status: text('status').default('completed'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// BILLBOARD DATA TABLE - UPDATED TO 512 DIMENSIONS
// ⭐ Added unique constraint on city+state for UPSERT support
export const billboardLocations = pgTable(
  'billboard_locations',
  {
    id: serial('id').primaryKey(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    county: text('county'),

    // New pricing structure fields
    avgDailyViews: text('avg_daily_views'),
    fourWeekRange: text('four_week_range'),
    market: text('market'),
    marketRange: text('market_range'),
    generalRange: text('general_range'),
    details: text('details'),

    // Average prices per month
    avgBullPricePerMonth: integer('avg_bull_price_per_month').default(0),
    avgStatBullViewsPerWeek: integer('avg_stat_bull_views_per_week').default(0),
    avgPosterPricePerMonth: integer('avg_poster_price_per_month').default(0),
    avgPosterViewsPerWeek: integer('avg_poster_views_per_week').default(0),
    avgDigitalPricePerMonth: integer('avg_digital_price_per_month').default(0),
    avgDigitalViewsPerWeek: integer('avg_digital_views_per_week').default(0),
    avgViewsPerPeriod: text('avg_views_per_period'),

    // ⭐ Vector embedding - 512 dimensions
    embedding: vector('embedding', { dimensions: 512 }),
  },
  (table) => ({
    embeddingIndex: index('embedding_index').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    cityStateIndex: index('city_state_idx').on(table.city, table.state),
    // ⭐ NEW: Unique constraint for UPSERT support
    cityStateUnique: unique('city_state_unique').on(table.city, table.state),
  }),
)

export type BillboardLocation = InferSelectModel<typeof billboardLocations>
export type NewBillboardLocation = typeof billboardLocations.$inferInsert

// Nutshell CRM lead tracking - wins and revenue
export const nutshellLeads = pgTable('nutshell_leads', {
  id: serial('id').primaryKey(),
  nutshellLeadId: integer('nutshell_lead_id').notNull().unique(),
  description: text('description'),
  status: integer('status').notNull().default(0), // 0=Open, 1=Won, 2=Lost, 3=Canceled
  value: numeric('value', { precision: 12, scale: 2 }),
  currency: varchar('currency', { length: 3 }).default('USD'),
  assigneeEmail: text('assignee_email'),
  createdByUserId: text('created_by_user_id').references(() => user.id, {
    onDelete: 'set null',
  }),
  nutshellCreatedAt: timestamp('nutshell_created_at'),
  closedAt: timestamp('closed_at'),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type NutshellLead = InferSelectModel<typeof nutshellLeads>
export type NewNutshellLead = typeof nutshellLeads.$inferInsert

// Call Attempt Outcomes — one row per Call Attempt (a single offer of an
// inbound sales call to a Sales Rep). Production-only; finalized once.
// See docs/adr/0001-store-call-attempt-outcomes-in-db.md
export const callAttemptOutcomes = pgTable(
  'call_attempt_outcomes',
  {
    // Idempotency key. ReservationSid for TaskRouter attempts;
    // `overflow:${callSid}` for the terminal overflow attempt.
    id: varchar('id', { length: 96 }).primaryKey().notNull(),

    userId: varchar('user_id', { length: 21 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    reservationSid: varchar('reservation_sid', { length: 34 }),
    taskSid: varchar('task_sid', { length: 34 }),
    callSid: varchar('call_sid', { length: 34 }),
    workerSid: varchar('worker_sid', { length: 34 }),
    // The browser/worker call leg SID, used to match a browser Reject click.
    workerCallSid: varchar('worker_call_sid', { length: 34 }),

    attemptType: varchar('attempt_type', { length: 20 })
      .notNull()
      .default('taskrouter'), // 'taskrouter' | 'overflow'

    outcome: varchar('outcome', { length: 20 }).notNull().default('pending'), // 'pending' | 'accepted' | 'rejected' | 'missed'

    finalSource: varchar('final_source', { length: 80 }),

    offeredAt: timestamp('offered_at').defaultNow().notNull(),
    finalizedAt: timestamp('finalized_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userOutcomeIdx: index('call_attempt_user_outcome_idx').on(
      table.userId,
      table.outcome,
    ),
    callSidIdx: index('call_attempt_call_sid_idx').on(table.callSid),
    workerCallSidIdx: index('call_attempt_worker_call_sid_idx').on(
      table.workerCallSid,
    ),
  }),
)

export type CallAttemptOutcome = InferSelectModel<typeof callAttemptOutcomes>
export type NewCallAttemptOutcome = typeof callAttemptOutcomes.$inferInsert
