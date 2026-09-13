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

export function voiceAgentResponse(): Response {
  const response = new twilio.twiml.VoiceResponse()
  response.redirect(
    { method: 'POST' },
    'https://voicemail-agent.john22n-iii.com/',
  )
  return new Response(response.toString(), {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
