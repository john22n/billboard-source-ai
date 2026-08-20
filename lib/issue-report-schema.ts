import { z } from 'zod'

export const issueReportSchema = z.object({
  requestId: z.string().uuid(),
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(20).max(4000),
  occurredAt: z.string().datetime({ offset: true }),
  lookbackMinutes: z.number().int().min(15).max(180),
})

export type IssueReportInput = z.infer<typeof issueReportSchema>

export const issueResolutionSchema = z.object({
  reportId: z.string().regex(/^ISS-[A-F0-9]{8}$/),
})

export interface IssueTwilioCall {
  callSid: string
  parentCallSid: string | null
  startedAt: string
  endedAt: string | null
  from: string
  to: string
  status: string
  durationSeconds: number
  direction: string
}

export interface IssueTwilioCallContext {
  phoneNumbers: string[]
  emailAddresses: string[]
  calls: IssueTwilioCall[]
}

export interface IssueDiagnosis {
  severity: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  evidence: Array<{
    source: 'report' | 'twilio' | 'vercel'
    detail: string
  }>
  missingData: string[]
  needsAmpEscalation: boolean
  escalationReason: string | null
  twilioCallInfoRequested: boolean
  twilioCallContext: IssueTwilioCallContext | null
}

export interface IssueReportResponse {
  reportId: string
  diagnosis: IssueDiagnosis
  unavailableSources: string[]
  ampEscalated: boolean
}
