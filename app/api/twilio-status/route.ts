import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req))) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const formData = await req.formData()

    // Parse callback
    const CallStatus = formData.get('CallStatus') as string
    const CallDuration = formData.get('CallDuration') as string

    console.log(`📊 Call status update: ${CallStatus}`, {
      CallStatus,
      CallDuration: CallDuration ? `${CallDuration}s` : undefined,
    })

    return new Response(null, { status: 204 })
  } catch {
    console.error('❌ Twilio status callback failed')
    return new Response('Error processing status', { status: 500 })
  }
}
