'use client'

import { useRef, useState, useCallback } from 'react'
import { Call } from '@twilio/voice-sdk'
import type { TranscriptItem } from '@/types/sales-call'
import { REALTIME_TRANSCRIPTION_MODEL } from '@/lib/openai-pricing'

interface UseOpenAITranscriptionOptions {
  onStatusChange?: (status: string) => void
}

interface TranscriptionSession {
  pc: RTCPeerConnection
  dc: RTCDataChannel | null
  speaker: 'agent' | 'caller'
}

interface CostLog {
  logId: number
  model: string
  startedAt: number
}

interface TranscriptionToken {
  value: string
  logId?: number
  model?: string
}

interface AudioSource {
  stream: MediaStream | null | undefined
  speaker: 'agent' | 'caller'
}

async function fetchTranscriptionToken(
  speaker: 'agent' | 'caller',
): Promise<TranscriptionToken | null> {
  const response = await fetch('/api/token')
  const data = (await response.json()) as Partial<TranscriptionToken>
  if (!response.ok || !data.value) {
    console.error(`${speaker} token fetch failed:`, data)
    return null
  }
  return data as TranscriptionToken
}

function getTokenModel(model: unknown) {
  return typeof model === 'string' ? model : REALTIME_TRANSCRIPTION_MODEL
}

function describeStream(stream: MediaStream | null | undefined) {
  return stream ? 'available' : 'not available'
}

function getTranscriptionStatus(sessionCount: number) {
  return sessionCount > 0
    ? 'Transcribing call...'
    : 'Could not start transcription'
}

async function createAvailableSessions(
  sources: AudioSource[],
  createSession: (
    stream: MediaStream,
    speaker: 'agent' | 'caller',
  ) => Promise<TranscriptionSession | null>,
) {
  const newSessions: TranscriptionSession[] = []
  for (const { stream, speaker } of sources) {
    if (!stream) continue
    const session = await createSession(stream, speaker)
    if (session) newSessions.push(session)
  }
  return newSessions
}

export function useOpenAITranscription(
  options: UseOpenAITranscriptionOptions = {},
) {
  const sessions = useRef<TranscriptionSession[]>([])
  const costLogs = useRef<CostLog[]>([])

  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([])
  const [interimTranscript, setInterimTranscript] = useState('')
  const [interimSpeaker, setInterimSpeaker] = useState<
    'agent' | 'caller' | null
  >(null)

  const reportStatus = useCallback(
    (status: string) => {
      options.onStatusChange?.(status)
    },
    [options],
  )

  const createTranscriptionSession = useCallback(
    async (
      stream: MediaStream,
      speaker: 'agent' | 'caller',
      ephemeralKey: string,
    ): Promise<TranscriptionSession | null> => {
      try {
        const pc = new RTCPeerConnection()
        const audioTrack = stream.getAudioTracks()[0]

        if (!audioTrack) {
          console.error(`No audio track for ${speaker}`)
          return null
        }

        pc.addTrack(audioTrack, stream)
        console.log(`Added ${speaker} audio track`)

        const dc = pc.createDataChannel('oai-events')

        dc.onopen = () => {
          console.log(`${speaker} data channel opened`)

          const sessionConfig = {
            type: 'session.update',
            session: {
              type: 'transcription',
              audio: {
                input: {
                  format: { type: 'audio/pcm', rate: 24000 },
                  transcription: {
                    model: 'whisper-1',
                    language: 'en',
                    prompt:
                      'Billboard, billboard advertising, bulletin, poster, digital billboard, static bulletin, out-of-home, OOH, CPM, impressions, DEC, daily effective circulation, vinyl, trivision, LED, Nutshell, Billboard Source',
                  },
                  turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 500,
                    silence_duration_ms: 1000,
                  },
                },
              },
            },
          }

          dc.send(JSON.stringify(sessionConfig))
        }

        dc.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)

            if (
              message.type ===
              'conversation.item.input_audio_transcription.delta'
            ) {
              setInterimTranscript((prev) => prev + message.delta)
              setInterimSpeaker(speaker)
            }

            if (
              message.type ===
              'conversation.item.input_audio_transcription.completed'
            ) {
              const newTranscript: TranscriptItem = {
                id: message.item_id,
                text: message.transcript,
                isFinal: true,
                timestamp: Date.now(),
                speaker,
              }
              setTranscripts((prev) => [...prev, newTranscript])
              setInterimTranscript('')
              setInterimSpeaker(null)
            }

            if (message.type === 'error') {
              console.error(`${speaker} error:`, message)
            }
          } catch (error) {
            console.error('Parse error:', error)
          }
        }

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        const sdpResponse = await fetch(
          'https://api.openai.com/v1/realtime/calls',
          {
            method: 'POST',
            body: offer.sdp,
            headers: {
              Authorization: `Bearer ${ephemeralKey}`,
              'Content-Type': 'application/sdp',
            },
          },
        )

        if (!sdpResponse.ok) {
          console.error(`${speaker} API error:`, await sdpResponse.text())
          return null
        }

        const answer = {
          type: 'answer' as RTCSdpType,
          sdp: await sdpResponse.text(),
        }

        await pc.setRemoteDescription(answer)
        console.log(`${speaker} session connected`)

        return { pc, dc, speaker }
      } catch (error) {
        console.error(`${speaker} session failed:`, error)
        return null
      }
    },
    [],
  )

  const createTrackedTranscriptionSession = useCallback(
    async (
      stream: MediaStream,
      speaker: 'agent' | 'caller',
    ): Promise<TranscriptionSession | null> => {
      reportStatus(`Fetching OpenAI token for ${speaker}...`)
      const token = await fetchTranscriptionToken(speaker)
      if (!token) return null

      const transcriptionSession = await createTranscriptionSession(
        stream,
        speaker,
        token.value,
      )

      if (transcriptionSession && typeof token.logId === 'number') {
        costLogs.current.push({
          logId: token.logId,
          model: getTokenModel(token.model),
          startedAt: Date.now(),
        })
      }

      return transcriptionSession
    },
    [createTranscriptionSession, reportStatus],
  )

  const startTranscription = useCallback(
    async (call: Call) => {
      try {
        reportStatus('Connecting transcription...')
        costLogs.current = []

        const remoteStream = call.getRemoteStream()
        const localStream = call.getLocalStream()

        console.log('Remote stream (caller):', describeStream(remoteStream))
        console.log('Local stream (agent):', describeStream(localStream))

        const newSessions = await createAvailableSessions(
          [
            { stream: remoteStream, speaker: 'caller' },
            { stream: localStream, speaker: 'agent' },
          ],
          createTrackedTranscriptionSession,
        )

        sessions.current = newSessions
        reportStatus(getTranscriptionStatus(newSessions.length))
      } catch (error) {
        console.error('Setup failed:', error)
        reportStatus('Error during setup')
      }
    },
    [createTrackedTranscriptionSession, reportStatus],
  )

  const stopTranscription = useCallback(async () => {
    const endedAt = Date.now()
    const logsToUpdate = costLogs.current
    costLogs.current = []

    // Close all sessions
    sessions.current.forEach((session) => {
      session.dc?.close()
      session.pc.close()
    })
    sessions.current = []

    if (logsToUpdate.length > 0) {
      try {
        await Promise.all(
          logsToUpdate.map(async (costLog) => {
            const durationSeconds = Math.max(
              0,
              (endedAt - costLog.startedAt) / 1000,
            )
            console.log(
              `Ended log ${costLog.logId} - Duration: ${durationSeconds.toFixed(2)}s`,
            )

            const costResponse = await fetch('/api/openai/update-cost', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              keepalive: true,
              body: JSON.stringify({
                logId: costLog.logId,
                durationSeconds,
                model: costLog.model,
              }),
            })

            if (costResponse.ok) {
              const costData = await costResponse.json()
              console.log(`Cost for log ${costLog.logId}: $${costData.cost}`)
            }
          }),
        )
      } catch (error) {
        console.error('Cost error:', error)
      }
    }

    setInterimTranscript('')
    setInterimSpeaker(null)
  }, [])

  const clearTranscripts = useCallback(() => {
    setTranscripts([])
    setInterimTranscript('')
    setInterimSpeaker(null)
  }, [])

  const addTranscript = useCallback((transcript: TranscriptItem) => {
    setTranscripts((prev) => [...prev, transcript])
  }, [])

  return {
    transcripts,
    interimTranscript,
    interimSpeaker,
    startTranscription,
    stopTranscription,
    clearTranscripts,
    addTranscript,
  }
}
