// lib/openai-pricing.ts

export const REALTIME_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper'

interface TokenPricing {
  inputPerMillion: number
  outputPerMillion: number
}

interface DurationPricing {
  perMinute: number
}

interface EmbeddingPricing {
  inputPerMillion: number
}

export interface TokenUsageLike {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  promptTokens?: number
  completionTokens?: number
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface NormalizedTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// Prices are USD per 1M tokens unless noted. Keep this list small and aligned
// with the models this app actually calls.
const TOKEN_PRICING: Record<string, TokenPricing> = {
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
}

const EMBEDDING_PRICING: Record<string, EmbeddingPricing> = {
  'text-embedding-3-small': { inputPerMillion: 0.02 },
}

const DURATION_PRICING: Record<string, DurationPricing> = {
  [REALTIME_TRANSCRIPTION_MODEL]: { perMinute: 0.017 },
  'gpt-4o-transcribe': { perMinute: 0.006 },
  'gpt-4o-mini-transcribe': { perMinute: 0.003 },
  'whisper-1': { perMinute: 0.006 },
}

function normalizeModelId(model: string): string {
  const normalized = model.toLowerCase()

  if (normalized.includes('gpt-realtime-whisper')) {
    return REALTIME_TRANSCRIPTION_MODEL
  }
  if (normalized.startsWith('gpt-4o-mini-transcribe')) {
    return 'gpt-4o-mini-transcribe'
  }
  if (normalized.startsWith('gpt-4o-transcribe')) {
    return 'gpt-4o-transcribe'
  }
  if (normalized.startsWith('whisper-1')) {
    return 'whisper-1'
  }
  if (normalized.startsWith('text-embedding-3-small')) {
    return 'text-embedding-3-small'
  }
  if (normalized.startsWith('gpt-4o-mini')) {
    return 'gpt-4o-mini'
  }
  if (normalized.startsWith('gpt-4o')) {
    return 'gpt-4o'
  }

  return normalized
}

export function normalizeTokenUsage(
  usage: TokenUsageLike | null | undefined,
): NormalizedTokenUsage {
  const promptTokens =
    usage?.inputTokens ?? usage?.promptTokens ?? usage?.prompt_tokens ?? 0
  const completionTokens =
    usage?.outputTokens ??
    usage?.completionTokens ??
    usage?.completion_tokens ??
    0
  const totalTokens =
    usage?.totalTokens ?? usage?.total_tokens ?? promptTokens + completionTokens

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  }
}

export function calculateOpenAITokenCost(
  model: string,
  usage: TokenUsageLike | null | undefined,
): number {
  const pricing = TOKEN_PRICING[normalizeModelId(model)]
  if (!pricing) return 0

  const { promptTokens, completionTokens } = normalizeTokenUsage(usage)

  return (
    (promptTokens / 1_000_000) * pricing.inputPerMillion +
    (completionTokens / 1_000_000) * pricing.outputPerMillion
  )
}

export function calculateOpenAIEmbeddingCost(
  model: string,
  inputTokens: number,
): number {
  const pricing = EMBEDDING_PRICING[normalizeModelId(model)]
  if (!pricing) return 0

  return (inputTokens / 1_000_000) * pricing.inputPerMillion
}

export function calculateOpenAIDurationCost(
  model: string,
  durationSeconds: number,
): number {
  const pricing = DURATION_PRICING[normalizeModelId(model)]
  if (!pricing) return 0

  return (durationSeconds / 60) * pricing.perMinute
}

// Backwards-compatible wrapper for older imports.
export function calculateOpenAICost(
  promptTokens: number,
  completionTokens: number,
  model: string,
): number {
  return calculateOpenAITokenCost(model, { promptTokens, completionTokens })
}
