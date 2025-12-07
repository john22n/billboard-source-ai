import { InferSelectModel, relations } from 'drizzle-orm'
import { pgTable, serial, text, timestamp, integer, numeric, pgEnum, uuid, varchar, primaryKey, boolean, vector } from 'drizzle-orm/pg-core'

// Your existing tables
export const user = pgTable('User', {
  id: varchar('id', { length: 21 }).primaryKey().notNull(),
  email: varchar('email', { length: 64 }).notNull(),
  password: varchar('password', { length: 64 }),
  role: varchar('role', { length: 20 }).default('user')
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
export const billboardLocations = pgTable('billboard_locations', {
  id: serial('id').primaryKey(),
  
  // Location data
  city: text('city').notNull(),
  state: text('state').notNull(),
  county: text('county').notNull(),
  
  // Market intelligence
  marketIntelligence: text('market_intelligence'),
  
  // Billboard availability
  hasStaticBulletin: boolean('has_static_bulletin').default(false),
  hasStaticPoster: boolean('has_static_poster').default(false),
  hasDigital: boolean('has_digital').default(false),
  
  // Vendor percentages
  lamarPercentage: integer('lamar_percentage').default(0),
  outfrontPercentage: integer('outfront_percentage').default(0),
  clearChannelPercentage: integer('clear_channel_percentage').default(0),
  otherVendorPercentage: integer('other_vendor_percentage').default(0),
  
  // Static Bulletin Pricing (4-week periods)
  staticBulletin12Week: integer('static_bulletin_12_week').default(0),
  staticBulletin24Week: integer('static_bulletin_24_week').default(0),
  staticBulletin52Week: integer('static_bulletin_52_week').default(0),
  staticBulletinImpressions: integer('static_bulletin_impressions').default(0),
  
  // Static Poster Pricing
  staticPoster12Week: integer('static_poster_12_week').default(0),
  staticPoster24Week: integer('static_poster_24_week').default(0),
  staticPoster52Week: integer('static_poster_52_week').default(0),
  staticPosterImpressions: integer('static_poster_impressions').default(0),
  
  // Digital Billboard Pricing
  digital12Week: integer('digital_12_week').default(0),
  digital24Week: integer('digital_24_week').default(0),
  digital52Week: integer('digital_52_week').default(0),
  digitalImpressions: integer('digital_impressions').default(0),
  
  // Vector embedding for semantic search
  embedding: vector('embedding', { dimensions: 1536 }), // OpenAI text-embedding-3-small
  
  // Metadata
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type BillboardLocation = InferSelectModel<typeof billboardLocations>;
export type NewBillboardLocation = typeof billboardLocations.$inferInsert;