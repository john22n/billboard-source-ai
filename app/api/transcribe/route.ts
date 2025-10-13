import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * POST: Create transcription session for real-time sales call
 * Uses gpt-4o-transcribe for high-accuracy transcription
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      language = 'en',
      customInstructions,
      speakerDiarization = true,
    } = body;

    // Build instructions for sales call transcription
    const instructions = customInstructions || `
You are transcribing a sales call. Please:
- Transcribe all speech accurately
- Identify different speakers (e.g., "Sales Rep:", "Customer:")
- Include natural pauses and emphasis
- Maintain professional terminology
- Note any important background information mentioned
${speakerDiarization ? '- Label speakers clearly' : ''}
    `.trim();

    // Create session with gpt-4o-transcribe model
    const sessionResponse = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-transcribe', // Specialized transcription model
        voice: 'alloy',
        modalities: ['text'], // Text output only (no audio generation)
        instructions: instructions,
        input_audio_format: 'pcm16',
        turn_detection: null, // Continuous transcription, no turn detection
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

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Transcribe using Whisper with detailed output
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      language: 'en',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });

    return NextResponse.json({
      success: true,
      text: transcription.text,
      segments: (transcription as any).segments,
      words: (transcription as any).words,
      duration: (transcription as any).duration,
    });

  } catch (error) {
    console.error('Error transcribing file:', error);
    return NextResponse.json(
      { error: 'Failed to transcribe file' },
      { status: 500 }
    );
  }
}
