// lib/schemas.ts
import { z } from "zod";

export const billboardLeadSchema = z.object({
  leadType: z.enum(["tire-kicker", "panel-requestor", "availer"]).nullable(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  advertiser: z.string().nullable(),
  hasMediaExperience: z.boolean().nullable(),
  hasDoneBillboards: z.boolean().nullable(),
  businessDescription: z.string().nullable(),
  yearsInBusiness: z.string().nullable(),
  billboardPurpose: z.string().nullable(),
  targetCity: z.string().nullable(),
  targetArea: z.string().nullable(),
  startMonth: z
    .enum([
      "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
      "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
    ])
    .nullable(),
  campaignLength: z
    .enum(["4WK", "8WK", "12WK", "24WK", "ANNUAL", "TBD"])
    .nullable(),
  budgetRange: z.enum(["small", "midsize", "major"]).nullable(),
  decisionMaker: z
    .enum(["alone", "partners", "boss", "committee"])
    .nullable(),
  notes: z.string().nullable(),
  confidence: z.object({
    overall: z.number().min(0).max(100),
    fieldsExtracted: z.number(),
    totalFields: z.number(),
  }),
});
