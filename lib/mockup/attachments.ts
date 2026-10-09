import { z } from 'zod'
import type { ModelMessage } from 'ai'
import { referenceLabelInstructions } from './instructions'

// Leave room for the selected image (2.8 MB) below Vercel's 4.5 MB request limit.
export const MAX_ATTACHMENTS = 1
export const MAX_REFERENCE_LENGTH = 400_000
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_PDF_PAGES = 50
export const MAX_SEARCH_PREVIEW_LENGTH = 60_000
export const attachmentSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  sourceType: z.enum(['image/png', 'image/jpeg', 'application/pdf']),
  pageNumber: z.number().int().min(1).max(MAX_PDF_PAGES).optional(),
  pageCount: z.number().int().min(1).max(MAX_PDF_PAGES).optional(),
  searchQuery: z.string().max(500).optional(),
  dataUrl: z
    .string()
    .max(MAX_REFERENCE_LENGTH)
    .refine((value) => {
      const match =
        /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
      if (!match || match[2].length % 4 !== 0) return false
      // Reject renamed files, arbitrary URLs and non-image payloads at both API boundaries.
      const bytes = atob(match[2])
      return match[1] === 'png'
        ? bytes.startsWith('\x89PNG\r\n\x1a\n')
        : bytes.startsWith('\xff\xd8\xff')
    }, 'Invalid image reference.'),
})
export const attachmentsSchema = z
  .array(attachmentSchema)
  .max(MAX_ATTACHMENTS)
  .default([])
export type CreativeAttachment = z.infer<typeof attachmentSchema>

export const pdfSearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().min(1).max(MAX_PDF_PAGES),
        dataUrl: attachmentSchema.shape.dataUrl.refine(
          (value) => value.length <= MAX_SEARCH_PREVIEW_LENGTH,
        ),
      }),
    )
    .min(1)
    .max(MAX_PDF_PAGES)
    .refine((pages) =>
      pages.every((page, index) => page.pageNumber === index + 1),
    ),
})
export const pdfSearchResultSchema = z.object({
  pageNumber: z.number().int().nullable(),
  reason: z.string().max(500),
})

export function attachmentLabel(file: CreativeAttachment) {
  if (file.sourceType !== 'application/pdf') return file.name
  return `${file.name} (PDF page ${file.pageNumber ?? 1} of ${file.pageCount ?? 1})${file.searchQuery ? ` · Selected for: ${file.searchQuery}` : ''}`
}

export function referenceMessages(
  text: string,
  attachments: CreativeAttachment[],
): ModelMessage[] {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text },
        ...attachments.flatMap((file) => [
          {
            type: 'text' as const,
            text: referenceLabelInstructions(attachmentLabel(file)),
          },
          {
            type: 'image' as const,
            image: Uint8Array.from(atob(file.dataUrl.split(',')[1]), (char) =>
              char.charCodeAt(0),
            ),
            mediaType: file.dataUrl.slice(5, file.dataUrl.indexOf(';')),
          },
        ]),
      ],
    },
  ]
}
