import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req))) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const formData = await req.formData()

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
