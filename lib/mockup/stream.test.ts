import { describe, expect, it } from 'vitest'
import { replyText, type WizardReply } from './stream'

describe('replyText', () => {
  it.each(['', ' \n '])(
    'retains commentary when the final answer is empty: %j',
    (answer) => {
      const message: WizardReply = {
        id: 'reply',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: 'What is the advertiser’s name?',
            providerMetadata: { openai: { phase: 'commentary' } },
          },
          {
            type: 'text',
            text: answer,
            providerMetadata: { openai: { phase: 'final_answer' } },
          },
        ],
      }
      expect(replyText(message).trim()).toBe('What is the advertiser’s name?')
    },
  )
})
