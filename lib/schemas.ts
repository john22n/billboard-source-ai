// lib/schemas.ts
import { z } from "zod";
import { LeadSentiment } from "@/types/sales-call";

export const billboardLeadSchema = z.object({
  // Lead classification - NOW USING ENUM VALUES
  leadType: z.enum([LeadSentiment.AVAILER, LeadSentiment.PANEL_REQUESTER, LeadSentiment.TIRE_KICKER]).nullable()
    .describe("Lead sentiment classification: 'Availer' (wants availability/inventory), 'Panel Requester' (wants specific panel info), or 'Tire Kicker' (low intent/browsing)"),
  
  // Entity information
  typeName: z.string().nullable()
    .describe("Type of entity (e.g., 'Est. B2B', 'New B2C', 'Political', 'Non-Profit', 'Personal')"),
  businessName: z.string().nullable()
    .describe("Industry/category for business (e.g., 'HVAC'), office for political (e.g., 'Governor'), service area for nonprofit"),
  entityName: z.string().nullable()
    .describe("Legal entity name (e.g., 'Bob's HVAC Company', 'Committee to Elect John Smith')"),
  
  // Contact information
  name: z.string().nullable().describe("Contact person's full name"),
  position: z.string().nullable().describe("Job title or position"),
  phone: z.string().nullable().describe("Phone number"),
  email: z.string().nullable().describe("Email address"),
  website: z.string().nullable().describe("Website URL"),
  decisionMaker: z.enum(["alone", "partners", "boss", "committee"]).nullable()
    .describe("Who makes the advertising decision"),
  
  // Billboard experience
  billboardsBeforeYN: z.string().nullable().describe("Y or N - have they used billboards before"),
  billboardsBeforeDetails: z.string().nullable().describe("Details about previous billboard experience"),
  
  // Campaign details
  billboardPurpose: z.string().nullable().describe("Main goal (e.g., brand awareness, event promotion)"),
  accomplishDetails: z.string().nullable().describe("Additional details about goals"),
  targetAudience: z.string().nullable().describe("Who they're trying to reach"),
  
  // Location (SEPARATED)
  targetCity: z.string().nullable().describe("Target city name (e.g., 'Austin', 'Los Angeles')"),
  state: z.string().nullable().describe("Two-letter state abbreviation (e.g., 'TX', 'CA', 'NY')"),
  targetArea: z.string().nullable().describe("County name OR highway/road (e.g., 'Travis County', 'I-35')"),
  
  // Timeline & preferences
  startMonth: z.string().nullable().describe("Campaign start month (e.g., 'January 2026')"),
  campaignLength: z.enum(["1 Mo", "2 Mo", "3 Mo", "6 Mo", "12 Mo", "TBD"]).nullable()
    .describe("Length of campaign in months"),
  boardType: z.string().nullable().describe("Static, Digital, or Both"),
  
  // Business context
  hasMediaExperience: z.boolean().nullable().describe("True if they are doing any other advertising or have prior media buying experience"),
  yearsInBusiness: z.string().nullable().describe("How long in business"),
  
  // Follow-up items
  sendOver: z.array(z.enum(["Avails", "Panel Info", "Planning Rates"])).nullable()
    .describe("What materials to send: Avails (availability list), Panel Info (specific billboard details), or Planning Rates (pricing information)"),
  
  // Notes
  notes: z.string().nullable().describe("Additional context from conversation"),
  
  confidence: z.object({
    overall: z.number().min(0).max(100),
    fieldsExtracted: z.number(),
    totalFields: z.number(),
  }),
}).describe("Schema for a billboard advertising lead extracted from a conversation");