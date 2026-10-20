import { nutshellRequest } from '@/lib/nutshell'
import {
  mockupFiles,
  sameAdvertiser,
  type LeadTarget,
  type MockupImage,
} from './state'

type NutshellFile = {
  id?: number
  entityType: string
  name: string
  uri?: string
  size?: number
}
type NutshellLead = {
  id: number
  name?: string
  description?: string
  rev: string
  primaryAccount?: { name: string }
  primaryAccountName?: string
  file?: NutshellFile[]
}

async function mockupNutshellRequest<T>(
  method: string,
  params: Record<string, unknown>,
  credentials: string,
): Promise<T> {
  const body = await nutshellRequest(method, params, credentials)
  if (body.error || !body.result) throw new Error('Nutshell request failed.')
  return body.result as T
}

function leadTarget(lead: NutshellLead): LeadTarget {
  return {
    id: Number(lead.id),
    name: lead.description || lead.name || `Lead ${lead.id}`,
    advertiser:
      lead.primaryAccount?.name ||
      lead.primaryAccountName ||
      lead.description ||
      '',
  }
}

/** Retry only missing files under deterministic names; never create another lead. */
export async function attachMockup(
  leadId: number,
  image: MockupImage,
  credentials: string,
) {
  let lead = await mockupNutshellRequest<NutshellLead>(
    'getLead',
    { leadId },
    credentials,
  )
  const target = leadTarget(lead)
  if (!sameAdvertiser(target.advertiser, image.advertiser))
    throw new Error(
      'The original lead’s advertiser does not match this mockup.',
    )
  const images = mockupFiles(image)
  const missing = images.filter(
    ({ name }) => !lead.file?.some((file) => file.name === name),
  )
  if (missing.length) {
    lead = await mockupNutshellRequest<NutshellLead>(
      'editLead',
      {
        leadId,
        rev: lead.rev,
        lead: {
          file: [
            ...(lead.file || []),
            ...missing.map(({ name }) => ({ entityType: 'Files', name })),
          ],
        },
      },
      credentials,
    )
  }
  for (const image of images) {
    const file = lead.file?.find((item) => item.name === image.name)
    if (file?.size) continue
    await uploadImage(file?.uri, image, credentials)
  }
  return target
}

async function uploadImage(
  uri: string | undefined,
  image: { dataUrl: string; name: string },
  credentials: string,
) {
  if (!uri) throw new Error('Nutshell did not provide an upload destination.')
  const url = new URL(uri)
  // Never leak CRM credentials to a redirect or arbitrary upload host.
  if (
    url.origin !== 'https://app.nutshell.com' ||
    !/^\/file\/api\/\d+$/.test(url.pathname) ||
    url.username ||
    url.password
  )
    throw new Error('Invalid Nutshell upload destination.')
  const form = new FormData()
  form.append(
    'file',
    new Blob([Buffer.from(image.dataUrl.split(',')[1], 'base64')], {
      type: 'image/jpeg',
    }),
    image.name,
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}` },
    body: form,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error('Nutshell image upload failed.')
}
