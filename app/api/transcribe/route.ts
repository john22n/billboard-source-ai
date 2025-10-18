// app/api/transcribe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * Helper function to track usage cost
 */
async function trackUsage(userId: string, model: string, usage: any, sessionId?: string) {
  try {
    await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/usage/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, model, usage, sessionId }),
    });
  } catch (error) {
    console.error('Failed to track usage:', error);
  }
}

/**
 * POST: Create transcription session for real-time sales call
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      userId, // REQUIRED: Add userId to request body
      language = 'en',
      customInstructions,
      speakerDiarization = true,
    } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const instructions = customInstructions || `
You are transcribing a sales call. Please:
- Transcribe all speech accurately
- Identify different speakers (e.g., "Sales Rep:", "Customer:")
- Include natural pauses and emphasis
- Maintain professional terminology
- Note any important background information mentioned
${speakerDiarization ? '- Label speakers clearly' : ''}
    `.trim();

    const sessionResponse = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-transcribe',
        voice: 'alloy',
        modalities: ['text'],
        instructions: instructions,
        input_audio_format: 'pcm16',
        turn_detection: null,
      }),
    });

    if (!sessionResponse.ok) {
      const errorData = await sessionResponse.json();
      throw new Error(errorData.error?.message || 'Failed to create session');
    }

    const sessionData = await sessionResponse.json();

    return NextResponse.json({
      success: true,
      clientSecret: sessionData.client_secret.value,
      sessionId: sessionData.id,
      expiresAt: sessionData.expires_at,
      model: 'gpt-4o-transcribe',
      userId, // Return userId for client-side tracking
    });
  } catch (error) {
    console.error('Error creating transcription session:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create session'
      },
      { status: 500 }
    );
  }
}

/**
 * PUT: Upload and transcribe a pre-recorded sales call file
 */
export async function PUT(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Transcribe using Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      language: 'en',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });

    // Track usage cost
    const duration = (transcription as any).duration || 0;
    await trackUsage(userId, 'whisper-1', {
      audio_duration: duration,
    });

    return NextResponse.json({
      success: true,
      text: transcription.text,
      segments: (transcription as any).segments,
      words: (transcription as any).words,
      duration: duration,
    });
  } catch (error) {
    console.error('Error transcribing file:', error);
    return NextResponse.json(
      { error: 'Failed to transcribe file' },
      { status: 500 }
    );
  }
}

/**
 * PATCH: Track real-time session usage
 * Called when a real-time session completes
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, sessionId, usage } = body;

    if (!userId || !usage) {
      return NextResponse.json(
        { error: 'userId and usage are required' },
        { status: 400 }
      );
    }

    // Track the usage
    await trackUsage(userId, 'gpt-4o-transcribe', usage, sessionId);

    return NextResponse.json({
      success: true,
      message: 'Usage tracked successfully',
    });
  } catch (error) {
    console.error('Error tracking session usage:', error);
    return NextResponse.json(
      { error: 'Failed to track usage' },
      { status: 500 }
    );
  }
}