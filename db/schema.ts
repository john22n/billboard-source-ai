import { InferSelectModel, relations } from 'drizzle-orm'
import { pgTable, serial, text, timestamp, integer, numeric, pgEnum, uuid, varchar, primaryKey } from 'drizzle-orm/pg-core'



export const user = pgTable('User', {
  id: varchar('id', { length: 21 }).primaryKey().notNull(),
  email: varchar('email', { length: 64 }).notNull(),
  password: varchar('password', { length: 64 })
})

export type User = InferSelectModel<typeof user>;


export const openaiLogs = pgTable("openai_logs", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull(),
  completionTokens: integer("completion_tokens").notNull(),
  totalTokens: integer("total_tokens").notNull(),
  cost: numeric("cost", { precision: 10, scale: 6 }).notNull(),
  sessionId: text("session_id"), // Add this - nullable since not all logs are sessions
  status: text("status").default("completed"), // Add this - "pending" or "completed"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});