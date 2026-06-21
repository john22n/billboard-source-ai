// app/api/transcribe-file/route.ts
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { generateObject } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { serverConfig } from '@/lib/config'

let openaiClient: OpenAI | null = null

function getOpenAIClient() {
  openaiClient ??= new OpenAI({
    apiKey: serverConfig.openai.requireApiKey(),
  })
  return openaiClient
}

// Combined analysis schema - single LLM call instead of 4 parallel calls
const fullAnalysisSchema = z.object({
  summary: z
    .string()
    .describe(
      '2-3 paragraph summary of the sales call covering main discussion points, client needs, solutions discussed, and next steps',
    ),

  keyPoints: z.object({
    clientName: z.string().nullable(),
    companyName: z.string().nullable(),
    industry: z.string().nullable(),
    companySize: z.string().nullable(),
    painPoints: z.array(z.string()),
    budget: z.string().nullable(),
    timeline: z.string().nullable(),
    competitors: z.array(z.string()),
    decisionMakers: z.array(z.string()),
    currentSolution: z.string().nullable(),
    objections: z.array(z.string()),
    requirements: z.array(z.string()),
  }),

  actionItems: z.array(
    z.object({
      action: z.string(),
      owner: z.enum(['Sales Rep', 'Customer', 'Both']),
      deadline: z.string().nullable(),
      priority: z.enum(['high', 'medium', 'low']),
    }),
  ),

  sentiment: z.object({
    overall: z.enum(['positive', 'neutral', 'negative']),
    clientEngagement: z.enum(['high', 'medium', 'low']),
    buyingSignals: z.array(z.string()),
    concerns: z.array(z.string()),
    dealLikelihood: z.enum(['high', 'medium', 'low']),
    confidenceScore: z.number().min(0).max(100),
    emotionalTone: z.enum([
      'enthusiastic',
      'interested',
      'skeptical',
      'resistant',
      'neutral',
    ]),
    reasoning: z.string(),
  }),
})

export async function POST(req: NextRequest) {
  try {
    // ✅ SECURITY: Require authentication
    const session = await getSession()
    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 },
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    console.log(
      '📁 Transcribing file:',
      file.name,
      `(${(file.size / 1024 / 1024).toFixed(2)} MB)`,
    )

    const openaiProvider = createOpenAI({
      apiKey: serverConfig.openai.requireApiKey(),
    })

    // Step 1: Transcribe the audio file using OpenAI Whisper
    const transcription = await getOpenAIClient().audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      language: 'en',
      prompt:
        'Billboard, billboard advertising, bulletin, poster, digital billboard, static bulletin, out-of-home, OOH, CPM, impressions, DEC, daily effective circulation, vinyl, trivision, LED, Nutshell, Billboard Source',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    })

    const transcript = transcription.text
    console.log('✅ Transcription complete, analyzing...')

    // Step 2: Single LLM call for all analysis (4x more efficient than parallel calls)
    const { object: analysis } = await generateObject({
      model: openaiProvider('gpt-4o-mini'),
      schema: fullAnalysisSchema,
      system: `You are a sales call analyst. Analyze this sales call transcript and extract all relevant information.
Be thorough and only include information that was explicitly mentioned. Use null for missing fields.`,
      prompt: transcript,
      temperature: 0.2,
    })

    console.log('✅ Analysis complete')

    return NextResponse.json({
      text: transcript,
      segments: transcription.segments,
      analysis,
    })
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    console.error('❌ Transcription error:', error)
    return NextResponse.json(
      { error: 'Failed to transcribe file', details: errorMessage },
      { status: 500 },
    )
  }
}
