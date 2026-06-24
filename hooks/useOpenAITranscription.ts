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

  const setStatus = useCallback(
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
      setStatus(`Fetching OpenAI token for ${speaker}...`)
      const tokenResponse = await fetch('/api/token')
      const data = await tokenResponse.json()

      if (!tokenResponse.ok || !data?.value) {
        console.error(`${speaker} token fetch failed:`, data)
        return null
      }

      const transcriptionSession = await createTranscriptionSession(
        stream,
        speaker,
        data.value,
      )

      if (transcriptionSession && typeof data.logId === 'number') {
        costLogs.current.push({
          logId: data.logId,
          model:
            typeof data.model === 'string'
              ? data.model
              : REALTIME_TRANSCRIPTION_MODEL,
          startedAt: Date.now(),
        })
      }

      return transcriptionSession
    },
    [createTranscriptionSession, setStatus],
  )

  const startTranscription = useCallback(
    async (call: Call) => {
      try {
        setStatus('Connecting transcription...')
        costLogs.current = []

        const remoteStream = call.getRemoteStream()
        const localStream = call.getLocalStream()

        console.log(
          'Remote stream (caller):',
          remoteStream ? 'available' : 'not available',
        )
        console.log(
          'Local stream (agent):',
          localStream ? 'available' : 'not available',
        )

        const newSessions: TranscriptionSession[] = []

        // Create separate session for caller audio
        if (remoteStream) {
          const callerSession = await createTrackedTranscriptionSession(
            remoteStream,
            'caller',
          )
          if (callerSession) newSessions.push(callerSession)
        }

        // Create separate session for agent audio
        if (localStream) {
          const agentSession = await createTrackedTranscriptionSession(
            localStream,
            'agent',
          )
          if (agentSession) newSessions.push(agentSession)
        }

        sessions.current = newSessions

        if (newSessions.length > 0) {
          setStatus('Transcribing call...')
        } else {
          setStatus('Could not start transcription')
        }
      } catch (error) {
        console.error('Setup failed:', error)
        setStatus('Error during setup')
      }
    },
    [createTrackedTranscriptionSession, setStatus],
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
