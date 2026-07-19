import 'server-only'

const VERCEL_BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com'

export function isVercelBlobUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith(VERCEL_BLOB_HOST_SUFFIX) &&
      url.hostname.length > VERCEL_BLOB_HOST_SUFFIX.length &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

export function fetchVercelBlob(value: string): Promise<Response> {
  if (!isVercelBlobUrl(value)) {
    throw new Error('Invalid Vercel Blob URL')
  }

  return fetch(value, { redirect: 'error' })
}
