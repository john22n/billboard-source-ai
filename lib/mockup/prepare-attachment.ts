import {
  attachmentSchema,
  MAX_FILE_BYTES,
  MAX_REFERENCE_LENGTH,
  type CreativeAttachment,
} from './attachments'

/** Decode locally; only the bounded visual reference leaves the browser. */
export async function prepareAttachment(
  file: File,
): Promise<CreativeAttachment> {
  if (!['image/png', 'image/jpeg', 'application/pdf'].includes(file.type))
    throw new Error('Choose a PNG, JPEG, or PDF file.')
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw new Error('Each file must be non-empty and no larger than 10 MB.')
  const canvas = document.createElement('canvas')
  try {
    if (file.type === 'application/pdf') {
      await renderPdf(file, canvas)
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
    let dataUrl = canvas.toDataURL(type, 0.85)
    while (
      dataUrl.length > MAX_REFERENCE_LENGTH &&
      Math.max(canvas.width, canvas.height) > 384
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
    return attachmentSchema.parse({
      id: crypto.randomUUID(),
      name: file.name.slice(0, 200),
      sourceType: file.type,
      dataUrl,
    })
  } catch {
    throw new Error(
      `Could not prepare ${file.name}. Use a readable PNG/JPEG or an unlocked PDF, or try a smaller file.`,
    )
  } finally {
    canvas.width = canvas.height = 0
  }
}

async function renderPdf(file: File, canvas: HTMLCanvasElement) {
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
    const page = await pdf.getPage(1)
    const natural = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({
      scale: Math.min(2, 1536 / Math.max(natural.width, natural.height)),
    })
    canvas.width = Math.max(1, Math.ceil(viewport.width))
    canvas.height = Math.max(1, Math.ceil(viewport.height))
    await page.render({ canvas, viewport }).promise
  } finally {
    await task.destroy()
  }
}
