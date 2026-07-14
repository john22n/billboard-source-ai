'use server'

import OpenAI from 'openai'
import { serverConfig } from '@/lib/config'

let openaiClient: OpenAI | null = null

function getOpenAIClient() {
  openaiClient ??= new OpenAI({
    apiKey: serverConfig.openai.requireApiKey(),
  })
  return openaiClient
}

export async function summarizeCall(transcript: string) {
  const result = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `
          You are a structured summarization agent.
          Summarize this sales call into an HTML form with fields:
          <CustomerName>, <Phone>, <Email>, <Website>, <Company Name>, and <Summary>.
        `,
      },
      { role: 'user', content: transcript },
    ],
  })

  return result.choices[0].message.content ?? ''
}
