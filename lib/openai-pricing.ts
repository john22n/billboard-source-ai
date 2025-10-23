// lib/openai-pricing.ts

interface ModelPricing {
  prompt: number;
  completion: number;
}

// Prices per 1K tokens (in USD) - Update these if OpenAI changes prices
const PRICING: Record<string, ModelPricing> = {
  "gpt-4": { 
    prompt: 0.03, 
    completion: 0.06 
  },
  "gpt-4-turbo": { 
    prompt: 0.01, 
    completion: 0.03 
  },
  "gpt-4-turbo-preview": { 
    prompt: 0.01, 
    completion: 0.03 
  },
  "gpt-3.5-turbo": { 
    prompt: 0.0005, 
    completion: 0.0015 
  },
  "gpt-3.5-turbo-16k": { 
    prompt: 0.003, 
    completion: 0.004 
  },
};

export function calculateOpenAICost(
  promptTokens: number,
  completionTokens: number,
  model: string
): number {
  // Get pricing for the model, default to gpt-3.5-turbo if not found
  const pricing = PRICING[model] || PRICING["gpt-3.5-turbo"];
  
  // Calculate cost: (tokens / 1000) * price per 1K tokens
  const promptCost = (promptTokens / 1000) * pricing.prompt;
  const completionCost = (completionTokens / 1000) * pricing.completion;
  
  return promptCost + completionCost;
}