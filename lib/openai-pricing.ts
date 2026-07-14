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

const MODEL_PREFIXES: Array<[string, string]> = [
  ['gpt-4o-mini-transcribe', 'gpt-4o-mini-transcribe'],
  ['gpt-4o-transcribe', 'gpt-4o-transcribe'],
  ['whisper-1', 'whisper-1'],
  ['text-embedding-3-small', 'text-embedding-3-small'],
  ['gpt-4o-mini', 'gpt-4o-mini'],
  ['gpt-4o', 'gpt-4o'],
]

function normalizeModelId(model: string): string {
  const normalized = model.toLowerCase()
  if (normalized.includes('gpt-realtime-whisper')) {
    return REALTIME_TRANSCRIPTION_MODEL
  }
  return (
    MODEL_PREFIXES.find(([prefix]) => normalized.startsWith(prefix))?.[1] ??
    normalized
  )
}

function firstTokenCount(...values: Array<number | undefined>) {
  return values.find((value) => value !== undefined) ?? 0
}

export function normalizeTokenUsage(
  usage: TokenUsageLike | null | undefined,
): NormalizedTokenUsage {
  const tokenUsage = usage || {}
  const promptTokens = firstTokenCount(
    tokenUsage.inputTokens,
    tokenUsage.promptTokens,
    tokenUsage.prompt_tokens,
  )
  const completionTokens = firstTokenCount(
    tokenUsage.outputTokens,
    tokenUsage.completionTokens,
    tokenUsage.completion_tokens,
  )
  const totalTokens = firstTokenCount(
    tokenUsage.totalTokens,
    tokenUsage.total_tokens,
    promptTokens + completionTokens,
  )

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
