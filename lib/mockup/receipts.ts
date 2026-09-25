import { createHash } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { serverConfig } from '@/lib/config'
import type { MockupImage } from './state'

export type MockupSession = { userId: string; sessionStartedAt: number }
const hash = (data: string) => createHash('sha256').update(data).digest('hex')
const key = () => new TextEncoder().encode(serverConfig.auth.jwtSecret)

/** Authenticity only; content is stored in this tab, never in a server-side gallery. */
export async function signArtifact(
  session: MockupSession,
  kind: 'logo' | 'image',
  data: string,
  advertiser: string,
  id: string,
) {
  return new SignJWT({
    hash: hash(data),
    advertiser,
    id,
    session: session.sessionStartedAt,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.userId)
    .setAudience(`mockup-${kind}`)
    .setIssuedAt()
    .setExpirationTime('10h')
    .sign(key())
}
export async function verifyArtifact(
  session: MockupSession,
  kind: 'logo' | 'image',
  data: string,
  advertiser: string,
  id: string,
  receipt: string,
) {
  const { payload } = await jwtVerify(receipt, key(), {
    algorithms: ['HS256'],
    audience: `mockup-${kind}`,
    subject: session.userId,
  })
  if (
    payload.hash !== hash(data) ||
    payload.advertiser !== advertiser ||
    payload.id !== id ||
    payload.session !== session.sessionStartedAt
  )
    throw new Error(
      'This mockup does not belong to the active advertiser and session.',
    )
}
export async function verifyImage(session: MockupSession, image: MockupImage) {
  await verifyArtifact(
    session,
    'image',
    image.dataUrl,
    image.advertiser,
    image.id,
    image.receipt,
  )
}
