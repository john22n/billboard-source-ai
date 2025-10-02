import { InferSelectModel, relations } from 'drizzle-orm'
import { pgTable, serial, text, timestamp, pgEnum, uuid, varchar, primaryKey } from 'drizzle-orm/pg-core'

export const user = pgTable('User', {
  id: varchar('id', { length: 21 }).primaryKey().notNull(),
  email: varchar('email', { length: 64 }).notNull(),
  password: varchar('password', { length: 64 })
})

export type User = InferSelectModel<typeof user>;

export const conversations = pgTable("Conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text("title"), // optional: for UI use
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  summary: text("summary")
});

export type Conversations = InferSelectModel<typeof conversations>;

export const messages = pgTable("Messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  sender: text("sender").notNull(), // 'user' or 'agent'
  text: text("text").notNull(),
  audioUrl: text("audio_url"), // optional: store link to generated audio
  timestamp: timestamp("timestamp").defaultNow(),
});

export type Messages = InferSelectModel<typeof messages>;

export const apiUsageLogs = pgTable("Api_usage_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => user.id),
  conversationId: uuid("conversation_id").references(() => conversations.id),
  model: text("model"), // e.g., 'gpt-4o'
  inputTokens: text("input_tokens"),
  outputTokens: text("output_tokens"),
  cost: text("cost"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ApiUsageLogs = InferSelectModel<typeof apiUsageLogs>;


