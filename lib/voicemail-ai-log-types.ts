export interface VoicemailAICall {
  sid: string
  from: string
  to: string
  startedAt: string
  status: string
  duration: number | null
}

export interface VoicemailAIPage {
  calls: VoicemailAICall[]
  since: string
  until: string
  warnings: string[]
}

export interface VoicemailAIDetail {
  errors: Array<{
    sid: string
    code: string
    message: string
    createdAt: string
  }>
  recordings: Array<{
    sid: string
    duration: number | null
    status: string
    transcriptions: Array<{
      sid: string
      text: string
      status: string
    }>
  }>
  warnings: string[]
}
