import twilio from 'twilio'
import { serverConfig } from '@/lib/config'

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone()
    const bodyText = await clonedReq.text()
    const formData = await req.formData()

    // Signature validation
    const twilioAuthToken = serverConfig.twilio.authToken
    if (twilioAuthToken) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || ''
      const webhookUrl = new URL(req.url).toString()

      const params: Record<string, string> = {}
      new URLSearchParams(bodyText).forEach(
        (value, key) => (params[key] = value),
      )

      if (
        !twilio.validateRequest(
          twilioAuthToken,
          twilioSignature,
          webhookUrl,
          params,
        )
      ) {
        console.error('❌ Invalid Twilio signature')
        return new Response('Forbidden', { status: 403 })
      }
    }

    // Parse callback
    const CallSid = formData.get('CallSid') as string
    const CallStatus = formData.get('CallStatus') as string
    const CallDuration = formData.get('CallDuration') as string
    const From = formData.get('From') as string
    const To = formData.get('To') as string
    const Timestamp = formData.get('Timestamp') as string

    console.log(`📊 Call status update: ${CallStatus}`, {
      CallSid,
      CallStatus,
      CallDuration: CallDuration ? `${CallDuration}s` : undefined,
      From,
      To,
      Timestamp,
    })

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('❌ Twilio status callback error:', error)
    return new Response('Error processing status', { status: 500 })
  }
}
