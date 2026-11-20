import { afterEach, expect, it, vi } from 'vitest'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { referenceMessages } from './attachments'

afterEach(() => vi.unstubAllGlobals())

it.each(['image/png', 'application/pdf'] as const)(
  'sends %s reference pixels without deprecated image parts',
  async (sourceType) => {
    const warnings = vi.fn()
    vi.stubGlobal('AI_SDK_LOG_WARNINGS', warnings)
    let body: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', async (_input: unknown, init: RequestInit) => {
      body = JSON.parse(init.body as string)
      return Response.json({
        id: 'resp_test',
        created_at: 1,
        model: 'gpt-5.4-mini',
        output: [
          {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'A logo', annotations: [] }],
          },
        ],
        usage: { input_tokens: 30, output_tokens: 4 },
      })
    })
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const result = await generateText({
      model: createOpenAI({ apiKey: 'test-key' })('gpt-5.4-mini'),
      messages: referenceMessages('Describe the reference', [
        {
          id: 'ref',
          name: 'Reference',
          sourceType,
          dataUrl,
        },
      ]),
    })
    expect(result.text).toBe('A logo')
    expect(body).toMatchObject({
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Describe the reference' },
            { type: 'input_text' },
            { type: 'input_image', image_url: dataUrl },
          ],
        },
      ],
    })
    expect(warnings.mock.calls.flatMap(([event]) => event.warnings)).toEqual([])
  },
)
