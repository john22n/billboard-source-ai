import {
  attachmentSchema,
  MAX_FILE_BYTES,
  MAX_REFERENCE_LENGTH,
  MAX_PDF_PAGES,
  MAX_SEARCH_PREVIEW_LENGTH,
  type CreativeAttachment,
} from './attachments'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/** Decode locally; only the bounded visual reference leaves the browser. */
export async function prepareAttachment(
  file: File,
  pageNumber = 1,
): Promise<CreativeAttachment> {
  if (!['image/png', 'image/jpeg', 'application/pdf'].includes(file.type))
    throw new Error('Choose a PNG, JPEG, or PDF file.')
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw new Error('Each file must be non-empty and no larger than 10 MB.')
  const canvas = document.createElement('canvas')
  try {
    let pageCount: number | undefined
    if (file.type === 'application/pdf') {
      pageCount = await withPdf(file, async (pdf) => {
        await renderPage(pdf, pageNumber, canvas, 1536)
        return pdf.numPages
      })
    } else {
      const bitmap = await createImageBitmap(file)
      try {
        const scale = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height))
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        canvas
          .getContext('2d')!
          .drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      } finally {
        bitmap.close()
      }
    }
    // Preserve transparency for uploaded PNG logos. PDFs have an opaque page.
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const dataUrl = encodeCanvas(canvas, type, MAX_REFERENCE_LENGTH)
    return attachmentSchema.parse({
      id: crypto.randomUUID(),
      name: file.name.slice(0, 200),
      sourceType: file.type,
      dataUrl,
      ...(pageCount ? { pageNumber, pageCount } : {}),
    })
  } catch (error) {
    throw new Error(
      `Could not prepare ${file.name}. Use a readable PNG/JPEG or an unlocked PDF (up to ${MAX_PDF_PAGES} pages). ${error instanceof Error ? error.message : ''}`,
    )
  } finally {
    canvas.width = canvas.height = 0
  }
}

export async function preparePdfSearch(file: File) {
  return withPdf(file, async (pdf) => {
    const pages = []
    const canvas = document.createElement('canvas')
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        await renderPage(pdf, pageNumber, canvas, 768)
        pages.push({
          pageNumber,
          dataUrl: encodeCanvas(
            canvas,
            'image/jpeg',
            MAX_SEARCH_PREVIEW_LENGTH,
          ),
        })
      }
      return pages
    } finally {
      canvas.width = canvas.height = 0
    }
  })
}

function encodeCanvas(canvas: HTMLCanvasElement, type: string, limit: number) {
  let dataUrl = canvas.toDataURL(type, 0.85)
  while (
    dataUrl.length > limit &&
    Math.max(canvas.width, canvas.height) > 128
  ) {
    const scaled = document.createElement('canvas')
    scaled.width = Math.max(1, Math.round(canvas.width * 0.75))
    scaled.height = Math.max(1, Math.round(canvas.height * 0.75))
    scaled
      .getContext('2d')!
      .drawImage(canvas, 0, 0, scaled.width, scaled.height)
    canvas.width = scaled.width
    canvas.height = scaled.height
    canvas.getContext('2d')!.drawImage(scaled, 0, 0)
    dataUrl = canvas.toDataURL(type, 0.85)
    scaled.width = scaled.height = 0
  }
  if (dataUrl.length > limit)
    throw new Error('Image is too detailed to prepare within the size limit.')
  return dataUrl
}

async function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  size: number,
) {
  const page = await pdf.getPage(pageNumber)
  const natural = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({
    scale: Math.min(2, size / Math.max(natural.width, natural.height)),
  })
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  await page.render({ canvas, viewport }).promise
  page.cleanup()
}

async function withPdf<T>(
  file: File,
  read: (pdf: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
  GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  const task = getDocument({
    data: await file.arrayBuffer(),
    useWasm: false,
    stopAtErrors: true,
  })
  try {
    const pdf = await task.promise
    if (pdf.numPages > MAX_PDF_PAGES)
      throw new Error(
        `PDF search supports up to ${MAX_PDF_PAGES} pages. Split this PDF into a smaller document.`,
      )
    return await read(pdf)
  } finally {
    await task.destroy()
  }
}
