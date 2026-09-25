import { NextResponse } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { getSession } from '@/lib/auth'
import { serverConfig } from '@/lib/config'
import { rateLimit } from '@/lib/rate-limit'
import { pdfSearchInstructions } from '@/lib/mockup/instructions'
import {
  pdfSearchSchema,
  pdfSearchResultSchema,
  referenceMessages,
} from '@/lib/mockup/attachments'

export const maxDuration = 90

export async function POST(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json(
      { error: 'Please sign in again.' },
      { status: 401 },
    )
  const input = pdfSearchSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!input.success)
    return NextResponse.json(
      {
        error:
          'Invalid PDF search. Include every page in order (up to 50 pages).',
      },
      { status: 400 },
    )
  if (!(await rateLimit('mockup-pdf-search', session.userId, 10, 60)).allowed)
    return NextResponse.json(
      { error: 'Please wait a minute before searching again.' },
      { status: 429 },
    )
  try {
    const { query, pages } = input.data
    const provider = createOpenAI({
      apiKey: serverConfig.openai.requireApiKey(),
    })
    const result = await generateObject({
      model: provider('gpt-5.4-mini'),
      schema: pdfSearchResultSchema,
      providerOptions: { openai: { strictJsonSchema: true } },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(60_000),
      system: pdfSearchInstructions,
      messages: referenceMessages(
        JSON.stringify({ query }),
        pages.map((page) => ({
          ...page,
          id: `page-${page.pageNumber}`,
          name: 'Uploaded PDF',
          sourceType: 'application/pdf',
          pageCount: pages.length,
        })),
      ),
    })
    const { pageNumber } = result.object
    if (pageNumber !== null && (pageNumber < 1 || pageNumber > pages.length))
      throw new Error('Invalid selected page')
    return NextResponse.json(result.object, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json(
      {
        error:
          'Could not search the PDF. Your selected reference is unchanged; please try again.',
      },
      { status: 502 },
    )
  }
}
