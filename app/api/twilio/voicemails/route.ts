/**
 * Fetch voicemails with transcriptions from Twilio
 * Returns recordings from the last 7 days with their transcriptions
 */

import { NextResponse } from 'next/server'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN

interface TwilioRecording {
  sid: string
  call_sid: string
  date_created: string
  duration: string
  source: string
  uri: string
}

interface TwilioTranscription {
  sid: string
  transcription_text: string
  status: string
  duration: string
}

export interface Voicemail {
  sid: string
  callSid: string
  from: string
  dateCreated: string
  duration: number
  recordingUrl: string
  transcription: string | null
  transcriptionStatus: string | null
}

export async function GET() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    return NextResponse.json(
      { error: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN required' },
      { status: 500 }
    )
  }

  try {
    const authHeader = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')

    // Get recordings from the last 7 days
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const dateCreatedAfter = sevenDaysAgo.toISOString().split('T')[0]

    const recordingsUrl = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings.json?DateCreatedAfter=${dateCreatedAfter}&PageSize=50`

    const recordingsResponse = await fetch(recordingsUrl, {
      headers: { Authorization: `Basic ${authHeader}` },
    })

    if (!recordingsResponse.ok) {
      const errorText = await recordingsResponse.text()
      console.error('Failed to fetch recordings:', errorText)
      return NextResponse.json(
        { error: 'Failed to fetch recordings from Twilio' },
        { status: 500 }
      )
    }

    const recordingsData = await recordingsResponse.json()
    const recordings: TwilioRecording[] = recordingsData.recordings || []

    // For each recording, fetch the call details (to get "From") and transcription
    const voicemails: Voicemail[] = await Promise.all(
      recordings.map(async (recording) => {
        // Fetch call details to get the "From" number
        let from = 'Unknown'
        try {
          const callUrl = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls/${recording.call_sid}.json`
          const callResponse = await fetch(callUrl, {
            headers: { Authorization: `Basic ${authHeader}` },
          })
          if (callResponse.ok) {
            const callData = await callResponse.json()
            from = callData.from || 'Unknown'
          }
        } catch (e) {
          console.error('Failed to fetch call details:', e)
        }

        // Fetch transcription for this recording
        let transcription: string | null = null
        let transcriptionStatus: string | null = null
        try {
          const transcriptionUrl = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${recording.sid}/Transcriptions.json`
          const transcriptionResponse = await fetch(transcriptionUrl, {
            headers: { Authorization: `Basic ${authHeader}` },
          })
          if (transcriptionResponse.ok) {
            const transcriptionData = await transcriptionResponse.json()
            const transcriptions: TwilioTranscription[] = transcriptionData.transcriptions || []
            if (transcriptions.length > 0) {
              transcription = transcriptions[0].transcription_text
              transcriptionStatus = transcriptions[0].status
            }
          }
        } catch (e) {
          console.error('Failed to fetch transcription:', e)
        }

        return {
          sid: recording.sid,
          callSid: recording.call_sid,
          from,
          dateCreated: recording.date_created,
          duration: parseInt(recording.duration, 10),
          recordingUrl: `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${recording.sid}.mp3`,
          transcription,
          transcriptionStatus,
        }
      })
    )

    // Sort by date descending (newest first)
    voicemails.sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime())

    return NextResponse.json({ voicemails })
  } catch (error) {
    console.error('Error fetching voicemails:', error)
    return NextResponse.json(
      { error: 'Failed to fetch voicemails' },
      { status: 500 }
    )
  }
}
