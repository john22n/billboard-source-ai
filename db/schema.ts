import { InferSelectModel, relations } from 'drizzle-orm'
import { pgTable, serial, text, timestamp, integer, numeric, index, varchar, vector } from 'drizzle-orm/pg-core'

// Your existing tables
export const user = pgTable('User', {
  id: varchar('id', { length: 21 }).primaryKey().notNull(),
  email: varchar('email', { length: 64 }).notNull(),
  password: varchar('password', { length: 64 }),
  role: varchar('role', { length: 20 }).default('user'),
  twilioPhoneNumber: varchar('twilio_phone_number', { length: 20 }),
  taskRouterWorkerSid: varchar('taskrouter_worker_sid', { length: 34 }),
  workerActivity: varchar('worker_activity', { length: 20 }).default('offline'),
})
export type User = InferSelectModel<typeof user>;

// Passkey credentials for WebAuthn authentication
export const passkey = pgTable('Passkey', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(), // UUID
  userId: varchar('user_id', { length: 21 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(), // Base64 encoded credential ID
  publicKey: text('public_key').notNull(), // Base64 encoded public key
  counter: integer('counter').notNull().default(0), // Signature counter for replay prevention
  deviceType: varchar('device_type', { length: 32 }), // 'platform' or 'cross-platform'
  transports: text('transports'), // JSON array: ['internal', 'usb', 'ble', 'nfc']
  name: varchar('name', { length: 64 }).default('Passkey'), // User-friendly name
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
export type Passkey = InferSelectModel<typeof passkey>;

export const openaiLogs = pgTable("openai_logs", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull(),
  completionTokens: integer("completion_tokens").notNull(),
  totalTokens: integer("total_tokens").notNull(),
  cost: numeric("cost", { precision: 10, scale: 6 }).notNull(),
  sessionId: text("session_id"),
  status: text("status").default("completed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ADD THIS NEW TABLE FOR BILLBOARD DATA
// db/schema-updated.ts
export const billboardLocations = pgTable(
  "billboard_locations",
  {
    id: serial("id").primaryKey(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    county: text("county"),
    
    // New pricing structure fields
    avgDailyViews: text("avg_daily_views"), // Can be empty
    fourWeekRange: text("four_week_range"), // Format: "$X,XXX-$X,XXX"
    market: text("market"), // Market name (e.g., "Phoenix", "DFW")
    marketRange: text("market_range"), // Market-specific range
    generalRange: text("general_range"), // General pricing tiers
    details: text("details"), // Street-specific rates and misc info
    
    // Average prices per month
    avgBullPricePerMonth: integer("avg_bull_price_per_month").default(0),
    avgStatBullViewsPerWeek: integer("avg_stat_bull_views_per_week").default(0),
    avgPosterPricePerMonth: integer("avg_poster_price_per_month").default(0),
    avgPosterViewsPerWeek: integer("avg_poster_views_per_week").default(0),
    avgDigitalPricePerMonth: integer("avg_digital_price_per_month").default(0),
    avgDigitalViewsPerWeek: integer("avg_digital_views_per_week").default(0),
    avgViewsPerPeriod: text("avg_views_per_period"),
    
    // Vector embedding for semantic search
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (table) => ({
    embeddingIndex: index("embedding_index").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    cityStateIndex: index("city_state_idx").on(table.city, table.state),
  })
);

export type BillboardLocation = InferSelectModel<typeof billboardLocations>;
export type NewBillboardLocation = typeof billboardLocations.$inferInsert;