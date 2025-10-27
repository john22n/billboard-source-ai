'use server';

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * Create a Realtime transcription session for sales calls
 * Uses gpt-4o-transcribe model for high-accuracy transcription
 */
export async function createTranscriptionSession(options?: {
  language?: string;
  speakerLabels?: boolean;
  customInstructions?: string;
}) {
  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-transcribe',
        voice: 'alloy', // Required but not used for transcription-only
        modalities: ['text'], // Transcription only, no audio output
        instructions: options?.customInstructions ||
          'Transcribe the sales call accurately. Identify different speakers. Include timestamps.',
        input_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1',
        },
        turn_detection: null, // Disable turn detection for continuous transcription
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Failed to create transcription session');
    }

    const data = await response.json();
    return {
      success: true,
      token: data.client_secret.value,
      sessionId: data.id,
      expiresAt: data.expires_at,
    };
  } catch (error) {
    console.error('Error creating transcription session:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Transcribe an uploaded audio file (for pre-recorded sales calls)
 * Uses standard Whisper API for file uploads
 */
export async function transcribeAudioFile(audioBase64: string, filename: string = 'sales_call.mp3') {
  try {
    const buffer = Buffer.from(audioBase64, 'base64');
    const file = new File([buffer], filename, { type: 'audio/mpeg' });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      language: 'en',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });

    return {
      success: true,
      text: transcription.text,
      segments: (transcription as any).segments,
      words: (transcription as any).words,
      duration: (transcription as any).duration,
    };
  } catch (error) {
    console.error('Error transcribing audio file:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Analyze transcribed sales call with GPT-4
 * Extract key insights, action items, and sentiment
 */
export async function analyzeSalesCall(transcript: string) {
  try {
    const completion = await openai.chat.completions.create({
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
Format your response as structured JSON.`
        },
        {
          role: 'user',
          content: `Analyze this sales call transcript:\n\n${transcript}`
        }
      ],
      response_format: { type: 'json_object' },
    });

    const analysis = JSON.parse(completion.choices[0].message.content || '{}');

    return {
      success: true,
      analysis,
    };
  } catch (error) {
    console.error('Error analyzing sales call:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}