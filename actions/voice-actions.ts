'use server';

import { openai } from '@ai-sdk/openai';
import { generateText, streamText, generateObject } from 'ai';
import { z } from 'zod';
import OpenAI from 'openai';

// Initialize OpenAI client for Realtime API (not yet in Vercel AI SDK)
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Create Realtime Session (using native OpenAI client)
export async function createRealtimeSession() {
  try {
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'alloy',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Failed to create session: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      success: true,
      token: data.client_secret.value,
      sessionId: data.id
    };
  } catch (error) {
    console.error('Error creating realtime session:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Generate text response using Vercel AI SDK
export async function generateTextResponse(prompt: string) {
  try {
    const { text } = await generateText({
      model: openai('gpt-4o'),
      prompt,
      maxTokens: 500,
    });

    return {
      success: true,
      text,
    };
  } catch (error) {
    console.error('Error generating text:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Stream text response using Vercel AI SDK
export async function streamTextResponse(prompt: string) {
  try {
    const result = await streamText({
      model: openai('gpt-4o'),
      prompt,
      maxTokens: 500,
    });

    return result.toAIStreamResponse();
  } catch (error) {
    console.error('Error streaming text:', error);
    throw error;
  }
}

// Generate structured output using Vercel AI SDK
export async function generateStructuredResponse(prompt: string) {
  try {
    const { object } = await generateObject({
      model: openai('gpt-4o'),
      schema: z.object({
        summary: z.string().describe('A brief summary of the response'),
        keyPoints: z.array(z.string()).describe('Key points from the conversation'),
        sentiment: z.enum(['positive', 'neutral', 'negative']).describe('Overall sentiment'),
      }),
      prompt,
    });

    return {
      success: true,
      data: object,
    };
  } catch (error) {
    console.error('Error generating structured response:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Transcribe audio using OpenAI Whisper (native client)
export async function transcribeAudio(audioBase64: string, filename: string = 'audio.wav') {
  try {
    // Convert base64 to File-like object
    const buffer = Buffer.from(audioBase64, 'base64');
    const file = new File([buffer], filename, { type: 'audio/wav' });

    const transcription = await openaiClient.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      language: 'en',
    });

    return {
      success: true,
      text: transcription.text,
    };
  } catch (error) {
    console.error('Error transcribing audio:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Generate speech using OpenAI TTS (native client)
export async function generateSpeech(
  text: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'alloy'
) {
  try {
    const mp3 = await openaiClient.audio.speech.create({
      model: 'tts-1',
      voice: voice,
      input: text,
      response_format: 'mp3',
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    return {
      success: true,
      audio: buffer.toString('base64'),
      contentType: 'audio/mpeg',
    };
  } catch (error) {
    console.error('Error generating speech:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Chat completion with conversation history using Vercel AI SDK
export async function chatCompletion(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>) {
  try {
    const { text } = await generateText({
      model: openai('gpt-4o'),
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      maxTokens: 1000,
    });

    return {
      success: true,
      response: text,
    };
  } catch (error) {
    console.error('Error in chat completion:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
