'use client'

import { useId, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMockupStore } from '@/stores/mockupStore'
import { searchPdfReference } from '@/lib/mockup/search-pdf'
import { getErrorMessage } from '@/lib/error-handling'

export function PdfReferenceSearch() {
  const { state, pdfSource, busy } = useMockupStore()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState('')
  const id = useId()

  async function search() {
    if (useMockupStore.getState().busy || !pdfSource || !query.trim()) return
    const epoch = useMockupStore.getState().epoch
    useMockupStore.setState({ busy: true, preparingFiles: true, error: '' })
    setResult('Searching every PDF page…')
    let error = ''
    try {
      const found = await searchPdfReference(pdfSource, query.trim())
      if (useMockupStore.getState().epoch !== epoch) return
      setResult(found.reason)
      if (found.reference)
        useMockupStore.getState().update({
          attachments: [found.reference],
          ...(!state.image ? { summary: null } : {}),
        })
    } catch (cause) {
      error = getErrorMessage(cause)
      setResult('Search failed. Your selected page is unchanged.')
    } finally {
      if (useMockupStore.getState().epoch === epoch)
        useMockupStore.setState({ busy: false, preparingFiles: false, error })
    }
  }

  if (!pdfSource)
    return (
      <p className="text-xs text-muted-foreground">
        The selected page is preserved. Remove and reattach the PDF to search
        again after a refresh.
      </p>
    )
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Find a logo or background in this PDF</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={busy}
          maxLength={500}
          placeholder="e.g. company logo or mountain background"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void search()
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || !query.trim()}
          onClick={() => void search()}
        >
          <Search className="size-4" data-icon="inline-start" />
          Search PDF
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {result ||
          `Searches all ${state.attachments[0]?.pageCount ?? 1} pages. Review the matching page before using it.`}
      </p>
    </div>
  )
}
