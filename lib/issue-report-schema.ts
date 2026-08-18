import { z } from 'zod'

export const issueReportSchema = z.object({
  requestId: z.string().uuid(),
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(20).max(4000),
  occurredAt: z.string().datetime({ offset: true }),
  lookbackMinutes: z.number().int().min(15).max(180),
})

export type IssueReportInput = z.infer<typeof issueReportSchema>

export interface IssueDiagnosis {
  severity: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  likelyCauses: string[]
  evidence: Array<{
    source: 'report' | 'twilio' | 'vercel'
    detail: string
  }>
  recommendedActions: string[]
  missingData: string[]
}

export interface IssueReportResponse {
  reportId: string
  slackChannelId: string
  slackMessageTs: string
  diagnosis: IssueDiagnosis
  unavailableSources: string[]
}
