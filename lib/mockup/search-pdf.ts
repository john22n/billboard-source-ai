import { pdfSearchResultSchema } from './attachments'
import { prepareAttachment, preparePdfSearch } from './prepare-attachment'

export async function searchPdfReference(file: File, query: string) {
  const pages = await preparePdfSearch(file)
  const response = await fetch('/api/mockup/search-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, pages }),
    signal: AbortSignal.timeout(75_000),
  })
  const body = await response.json()
  if (!response.ok)
    throw new Error(body.error || 'Could not search the PDF. Please try again.')
  const result = pdfSearchResultSchema.parse(body)
  if (result.pageNumber === null)
    return { reference: null, reason: result.reason }
  if (result.pageNumber < 1 || result.pageNumber > pages.length)
    throw new Error('The PDF search returned an invalid page.')
  const reference = await prepareAttachment(file, result.pageNumber)
  return {
    reference: { ...reference, searchQuery: query },
    reason: result.reason,
  }
}
