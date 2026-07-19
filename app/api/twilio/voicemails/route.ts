/**
 * Fetch voicemails with transcriptions from Twilio
 * Returns recordings from the last 7 days with their transcriptions
 */

import { NextResponse } from 'next/server'
import {
  configErrorResponseBody,
  isMissingConfig,
  serverConfig,
} from '@/lib/config'
import { getSession } from '@/lib/auth'

interface TwilioRecording {
  sid: string
  call_sid: string
  date_created: string
  duration: string
  source: string
  uri: string
}

interface TwilioRecordingsResponse {
  recordings: TwilioRecording[]
  next_page_uri: string | null
}

interface TwilioTranscription {
  sid: string
  transcription_text: string
  status: string
  duration: string
}

interface Voicemail {
  sid: string
  callSid: string
  from: string
  dateCreated: string
  duration: number
  recordingUrl: string
  transcription: string | null
  transcriptionStatus: string | null
}

async function adminAuthorizationError() {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}

async function GET() {
  let credentials: ReturnType<
    typeof serverConfig.twilio.requireAccountCredentials
  >
  try {
    credentials = serverConfig.twilio.requireAccountCredentials()
  } catch (error) {
    if (!isMissingConfig(error)) throw error
    return NextResponse.json(configErrorResponseBody(error), { status: 500 })
  }

  try {
    const authHeader = Buffer.from(
      `${credentials.accountSid}:${credentials.authToken}`,
    ).toString('base64')

    // Get recordings from the last 7 days
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const dateCreatedAfter = sevenDaysAgo.toISOString().split('T')[0]

    // Paginate through all recordings to avoid missing voicemails
    // buried behind DialVerb call recordings in the first page
    let allRecordings: TwilioRecording[] = []
    let nextPageUrl: string | null =
      `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Recordings.json?DateCreatedAfter=${dateCreatedAfter}&PageSize=100`

    while (nextPageUrl) {
      const recordingsResponse = await fetch(nextPageUrl, {
        headers: { Authorization: `Basic ${authHeader}` },
      })

      if (!recordingsResponse.ok) {
        console.error(
          'Failed to fetch recordings with status:',
          recordingsResponse.status,
        )
        return NextResponse.json(
          { error: 'Failed to fetch recordings from Twilio' },
          { status: 500 },
        )
      }

      const recordingsData: TwilioRecordingsResponse =
        await recordingsResponse.json()
      allRecordings = allRecordings.concat(recordingsData.recordings || [])

      // Twilio provides next_page_uri when there are more results
      nextPageUrl = recordingsData.next_page_uri
        ? `https://api.twilio.com${recordingsData.next_page_uri}`
        : null
    }

    const recordings = allRecordings.filter(
      (r: TwilioRecording) => r.source === 'RecordVerb',
    )

    console.log(
      `Total recordings: ${allRecordings.length}, voicemails after filter: ${recordings.length}`,
    )

    // For each recording, fetch the call details (to get "From") and transcription
    const voicemails: Voicemail[] = await Promise.all(
      recordings.map(async (recording) => {
        // Fetch call details to get the "From" number
        let from = 'Unknown'
        try {
          const callUrl = `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Calls/${recording.call_sid}.json`
          const callResponse = await fetch(callUrl, {
            headers: { Authorization: `Basic ${authHeader}` },
          })
          if (callResponse.ok) {
            const callData = await callResponse.json()
            from = callData.from || 'Unknown'
          }
        } catch {
          console.error('Failed to fetch call details')
        }

        // Fetch transcription for this recording
        let transcription: string | null = null
        let transcriptionStatus: string | null = null
        try {
          const transcriptionUrl = `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Recordings/${recording.sid}/Transcriptions.json`
          const transcriptionResponse = await fetch(transcriptionUrl, {
            headers: { Authorization: `Basic ${authHeader}` },
          })
          if (transcriptionResponse.ok) {
            const transcriptionData = await transcriptionResponse.json()
            const transcriptions: TwilioTranscription[] =
              transcriptionData.transcriptions || []
            if (transcriptions.length > 0) {
              transcription = transcriptions[0].transcription_text
              transcriptionStatus = transcriptions[0].status
            }
          }
        } catch {
          console.error('Failed to fetch transcription')
        }

        return {
          sid: recording.sid,
          callSid: recording.call_sid,
          from,
          dateCreated: recording.date_created,
          duration: parseInt(recording.duration, 10),
          recordingUrl: `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Recordings/${recording.sid}.mp3`,
          transcription,
          transcriptionStatus,
        }
      }),
    )

    // Sort by date descending (newest first)
    voicemails.sort(
      (a, b) =>
        new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
    )

    return NextResponse.json({ voicemails })
  } catch {
    console.error('Error fetching voicemails')
    return NextResponse.json(
      { error: 'Failed to fetch voicemails' },
      { status: 500 },
    )
  }
}

async function authorizedGET() {
  return (await adminAuthorizationError()) ?? GET()
}

export { authorizedGET as GET }
