'use server'

import { createOpenAI } from '@ai-sdk/openai'
import { generateText, streamText, generateObject } from 'ai'
import { z } from 'zod'
import OpenAI from 'openai'
import { serverConfig } from '@/lib/config'
import { getSession } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

const MAX_TEXT = 100_000
const MAX_BASE64_AUDIO = Math.ceil((25 * 1024 * 1024 * 4) / 3) + 4
const textSchema = z.string().max(MAX_TEXT)
const audioInputSchema = z.object({
  audioBase64: z.string().min(1).max(MAX_BASE64_AUDIO).base64(),
  filename: z.string().min(1).max(255),
})
const messagesSchema = z
  .array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
    }),
  )
  .max(100)

function prepareAudioFile(audioBase64: string, filename: string) {
  const input = audioInputSchema.safeParse({ audioBase64, filename })
  if (!input.success) return { error: 'Invalid audio input' } as const
  const buffer = Buffer.from(input.data.audioBase64, 'base64')
  if (buffer.byteLength > 25 * 1024 * 1024) {
    return { error: 'Input too large' } as const
  }
  return {
    file: new File([buffer], input.data.filename, { type: 'audio/wav' }),
  }
}

function parseMessages(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
) {
  const input = messagesSchema.safeParse(messages)
  if (!input.success) return null
  const totalLength = input.data.reduce(
    (total, message) => total + message.content.length,
    0,
  )
  return totalLength <= MAX_TEXT ? input.data : null
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

// Initialize OpenAI client for Realtime API (not yet in Vercel AI SDK)
let openaiClient: OpenAI | null = null

function getOpenAIClient() {
  openaiClient ??= new OpenAI({
    apiKey: serverConfig.openai.requireApiKey(),
  })
  return openaiClient
}

function getOpenAIProvider() {
  return createOpenAI({
    apiKey: serverConfig.openai.requireApiKey(),
  })
}

// Create Realtime Session (using native OpenAI client)
export async function createRealtimeSession() {
  try {
    const denied = await authorizeAIAction()
    if (denied) return denied
    const openaiApiKey = serverConfig.openai.requireApiKey()

    const response = await fetch(
      'https://api.openai.com/v1/realtime/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-realtime-preview-2024-12-17',
          voice: 'alloy',
        }),
      },
    )

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(
        errorData.error?.message ||
          `Failed to create session: ${response.statusText}`,
      )
    }

    const data = await response.json()
    return {
      success: true,
      token: data.client_secret.value,
      sessionId: data.id,
    }
  } catch {
    console.error('Error creating realtime session')
    return {
      success: false,
      error: 'Request failed',
    }
  }
}

// Generate text response using Vercel AI SDK
export async function generateTextResponse(prompt: string) {
  try {
    const denied = await authorizeAIAction()
    if (denied) return denied
    const input = textSchema.safeParse(prompt)
    if (!input.success) return { success: false, error: 'Input too large' }
    const { text } = await generateText({
      model: getOpenAIProvider()('gpt-4o-mini'),
      prompt: input.data,
    })

    return {
      success: true,
      text,
    }
  } catch {
    console.error('Error generating text')
    return {
      success: false,
      error: 'Request failed',
    }
  }
}

// Stream text response using Vercel AI SDK
export async function streamTextResponse(prompt: string) {
  try {
    const denied = await authorizeAIAction()
    if (denied) return denied
    const input = textSchema.safeParse(prompt)
    if (!input.success) return { success: false, error: 'Input too large' }
    const result = await streamText({
      model: getOpenAIProvider()('gpt-4o-mini'),
      prompt: input.data,
    })

    return result.toTextStreamResponse()
  } catch {
    console.error('Error streaming text')
    return { success: false, error: 'Request failed' }
  }
}

// Generate structured output using Vercel AI SDK
export async function generateStructuredResponse(prompt: string) {
  try {
    const denied = await authorizeAIAction()
    if (denied) return denied
    const input = textSchema.safeParse(prompt)
    if (!input.success) return { success: false, error: 'Input too large' }
    const { object } = await generateObject({
      model: getOpenAIProvider()('gpt-4o-mini'),
      schema: z.object({
        summary: z.string().describe('A brief summary of the response'),
        keyPoints: z
          .array(z.string())
          .describe('Key points from the conversation'),
        sentiment: z
          .enum(['positive', 'neutral', 'negative'])
          .describe('Overall sentiment'),
      }),
      prompt: input.data,
      temperature: 0.2,
    })

    return {
      success: true,
      data: object,
    }
  } catch {
    console.error('Error generating structured response')
    return {
      success: false,
      error: 'Request failed',
    }
  }
}

// Transcribe audio using OpenAI Whisper (native client)
export async function transcribeAudio(
  audioBase64: string,
  filename: string = 'audio.wav',
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
    })

    return {
      success: true,
      text: transcription.text,
    }
  } catch {
    console.error('Error transcribing audio')
    return {
      success: false,
      error: 'Request failed',
    }
  }
}

// Generate speech using OpenAI TTS (native client)
export async function generateSpeech(
  text: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'alloy',
) {
  try {
    const denied = await authorizeAIAction()
    if (denied) return denied
    const input = textSchema.safeParse(text)
    if (!input.success) return { success: false, error: 'Input too large' }
    const mp3 = await getOpenAIClient().audio.speech.create({
      model: 'tts-1',
      voice: voice,
      input: input.data,
      response_format: 'mp3',
    })

    const buffer = Buffer.from(await mp3.arrayBuffer())
    return {
      success: true,
      audio: buffer.toString('base64'),
      contentType: 'audio/mpeg',
    }
  } catch {
    console.error('Error generating speech')
    return {
      success: false,
      error: 'Request failed',
    }
  }
}

// Chat completion with conversation history using Vercel AI SDK
export async function chatCompletion(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
) {
  try {
    const denied = await authorizeAIAction()
    if (denied) return denied
    const input = parseMessages(messages)
    if (!input) {
      return { success: false, error: 'Input too large' }
    }
    const { text } = await generateText({
      model: getOpenAIProvider()('gpt-4o-mini'),
      messages: input.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    })

    return {
      success: true,
      response: text,
    }
  } catch {
    console.error('Error in chat completion')
    return {
      success: false,
      error: 'Request failed',
    }
  }
}
