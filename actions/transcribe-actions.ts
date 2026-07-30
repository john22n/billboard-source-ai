'use server'

import OpenAI from 'openai'
import { serverConfig } from '@/lib/config'
import { getSession } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

const MAX_TEXT = 100_000
const MAX_BASE64_AUDIO = Math.ceil((25 * 1024 * 1024 * 4) / 3) + 4
const transcriptionOptionsSchema = z
  .object({
    language: z.string().max(20).optional(),
    speakerLabels: z.boolean().optional(),
    customInstructions: z.string().max(MAX_TEXT).optional(),
  })
  .strict()
  .optional()
const audioInputSchema = z.object({
  audioBase64: z.string().min(1).max(MAX_BASE64_AUDIO).base64(),
  filename: z.string().min(1).max(255),
})
const transcriptSchema = z.string().max(MAX_TEXT)

function prepareAudioFile(audioBase64: string, filename: string) {
  const input = audioInputSchema.safeParse({ audioBase64, filename })
  if (!input.success) return { error: 'Invalid audio input' } as const
  const buffer = Buffer.from(input.data.audioBase64, 'base64')
  if (buffer.byteLength > 25 * 1024 * 1024) {
    return { error: 'Input too large' } as const
  }
  return {
    file: new File([buffer], input.data.filename, { type: 'audio/mpeg' }),
  }
}

function parseAnalysis(content: string | null) {
  return JSON.parse(content || '{}')
}

async function authorizeAIAction() {
  const session = await getSession()
  if (!session?.userId)
    return { success: false, error: 'Unauthorized' } as const
  const attempt = await rateLimit('ai-actions', session.userId, 20, 60)
  if (!attempt.allowed) {
    return { success: false, error: 'Rate limit exceeded' } as const
  }
  return null
}

let openaiClient: OpenAI | null = null

function getOpenAIClient() {
  openaiClient ??= new OpenAI({
    apiKey: serverConfig.openai.requireApiKey(),
  })
  return openaiClient
}

/**
 * Create a Realtime transcription session for sales calls
 * Uses gpt-4o-transcribe model for high-accuracy transcription
 */
export async function createTranscriptionSession(options?: {
  language?: string
  speakerLabels?: boolean
  customInstructions?: string
}) {
  try {
    const denied = await authorizeAIAction()
    if (denied) return denied
    const input = transcriptionOptionsSchema.safeParse(options)
    if (!input.success) {
      return { success: false, error: 'Input too large' }
    }
    const openaiApiKey = serverConfig.openai.requireApiKey()

    const response = await fetch(
      'https://api.openai.com/v1/realtime/client_secrets',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-transcribe',
          voice: 'alloy', // Required but not used for transcription-only
          modalities: ['text'], // Transcription only, no audio output
          instructions:
            input.data?.customInstructions ||
            'Transcribe the sales call accurately. Identify different speakers. Include timestamps.',
          input_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1',
          },
          turn_detection: null, // Disable turn detection for continuous transcription
        }),
      },
    )

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(
        errorData.error?.message || 'Failed to create transcription session',
      )
    }

    const data = await response.json()
    return {
      success: true,
      token: data.client_secret.value,
      sessionId: data.id,
      expiresAt: data.expires_at,
    }
  } catch {
    console.error('Error creating transcription session')
    return {
      success: false,
      error: 'Request failed',
    }
  }
}

/**
 * Transcribe an uploaded audio file (for pre-recorded sales calls)
 * Uses standard Whisper API for file uploads
 */
export async function transcribeAudioFile(
  audioBase64: string,
  filename: string = 'sales_call.mp3',
) {
  try {
    const denied = await authorizeAIAction()
    if (denied) return denied
    const prepared = prepareAudioFile(audioBase64, filename)
    if ('error' in prepared) return { success: false, error: prepared.error }

    const transcription = await getOpenAIClient().audio.transcriptions.create({
      file: prepared.file,
      model: 'whisper-1',
      language: 'en',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    })

    const verboseTranscription = transcription as typeof transcription & {
      segments?: unknown
      words?: unknown
      duration?: number
    }

    return {
      success: true,
      text: transcription.text,
      segments: verboseTranscription.segments,
      words: verboseTranscription.words,
      duration: verboseTranscription.duration,
    }
  } catch {
    console.error('Error transcribing audio file')
    return {
      success: false,
      error: 'Request failed',
    }
  }
}

/**
 * Analyze transcribed sales call with GPT-4
 * Extract key insights, action items, and sentiment
 */
export async function analyzeSalesCall(transcript: string) {
  try {
    const denied = await authorizeAIAction()
    if (denied) return denied
    const input = transcriptSchema.safeParse(transcript)
    if (!input.success) {
      return { success: false, error: 'Input too large' }
    }
    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a sales call analysis expert. Analyze sales call transcripts and provide:
1. Summary of the call
2. Key points discussed
3. Customer pain points identified
4. Action items and next steps
5. Sentiment analysis
6. Sales outcome/opportunities
Format your response as structured JSON.`,
        },
        {
          role: 'user',
          content: `Analyze this sales call transcript:\n\n${input.data}`,
        },
      ],
      response_format: { type: 'json_object' },
    })

    const analysis = parseAnalysis(completion.choices[0].message.content)

    return {
      success: true,
      analysis,
    }
  } catch {
    console.error('Error analyzing sales call')
    return {
      success: false,
      error: 'Request failed',
    }
  }
}
