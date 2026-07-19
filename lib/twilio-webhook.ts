import 'server-only'

import twilio from 'twilio'
import { serverConfig } from '@/lib/config'

/** Validates a Twilio webhook without consuming the request body. */
export async function isValidTwilioWebhook(req: Request): Promise<boolean> {
  const authToken = serverConfig.twilio.authToken
  const signature = req.headers.get('X-Twilio-Signature')

  if (!authToken || !signature) return false

  try {
    const body = await req.clone().text()
    const params: Record<string, string | string[]> = Object.create(null)

    for (const [key, value] of new URLSearchParams(body)) {
      const existing = params[key]
      if (existing === undefined) {
        params[key] = value
      } else if (Array.isArray(existing)) {
        existing.push(value)
      } else {
        params[key] = [existing, value]
      }
    }

    return twilio.validateRequest(authToken, signature, req.url, params)
  } catch {
    return false
  }
}
