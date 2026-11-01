/**
 * Model selection for direct OpenAI calls (AI SDK and native client).
 * Change a role here to update all its callers and their usage-log model IDs.
 * Evaluate replacements before rollout and add their rates to openai-pricing.ts;
 * historical pricing must stay keyed by the model that actually incurred usage.
 */
export const aiModels = {
  // Extraction, summaries, location lookup, diagnostics, and voice text/chat.
  text: 'gpt-4o-mini',
  salesAnalysis: 'gpt-4o',
  // Mockup chat, PDF search, and vision-based artwork cropping.
  mockup: 'gpt-5.4-mini',
  image: 'gpt-image-2.5-sunburst',
  transcription: 'gpt-4o-transcribe',
  fileTranscription: 'whisper-1',
  realtimeVoice: 'gpt-4o-realtime-preview-2024-12-17',
  speech: 'tts-1',
  // Query and stored embeddings must use the same model and dimensions.
  // Changing this requires regenerating stored market-data embeddings.
  embedding: 'text-embedding-3-small',
} as const
