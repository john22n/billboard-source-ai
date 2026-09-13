import twilio from 'twilio'

export function isVoiceAgentWindow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const day = parts.find((part) => part.type === 'weekday')?.value
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  return (day === 'Sat' || day === 'Sun') && hour >= 9 && hour < 13
}

export function voiceAgentResponse(requestUrl: string): Response {
  const response = new twilio.twiml.VoiceResponse()
  response.say('This call will be recorded and transcribed.')
  response.start().recording({
    channels: 'dual',
    track: 'both',
    recordingStatusCallback: new URL(
      '/api/twilio/voicemail-ai-recording#rc=3&rp=ct,rt,5xx',
      requestUrl,
    ).toString(),
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: ['completed'],
  })
  response.redirect(
    { method: 'POST' },
    'https://voicemail-agent.john22n-iii.com/',
  )
  return new Response(response.toString(), {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
