import { beforeEach, describe, expect, it, vi } from 'vitest'

const { validateRequest, twilioConfig } = vi.hoisted(() => ({
  validateRequest: vi.fn(),
  twilioConfig: { authToken: 'auth-token' as string | undefined },
}))

vi.mock('server-only', () => ({}))
vi.mock('twilio', () => ({ default: { validateRequest } }))
vi.mock('@/lib/config', () => ({
  serverConfig: { twilio: twilioConfig },
}))

import { isValidTwilioWebhook } from './twilio-webhook'

describe('isValidTwilioWebhook', () => {
  beforeEach(() => {
    twilioConfig.authToken = 'auth-token'
    validateRequest.mockReset().mockReturnValue(true)
  })

  it('validates the exact request URL and form body without consuming it', async () => {
    const url = 'https://example.com/api/webhook?token=a%2Bb'
    const body = 'CallSid=CA123&From=%2B15551234567'
    const req = new Request(url, {
      method: 'POST',
      headers: { 'X-Twilio-Signature': 'signature' },
      body,
    })

    await expect(isValidTwilioWebhook(req)).resolves.toBe(true)
    expect(validateRequest).toHaveBeenCalledWith(
      'auth-token',
      'signature',
      url,
      { CallSid: 'CA123', From: '+15551234567' },
    )
    await expect(req.text()).resolves.toBe(body)
  })

  it('preserves duplicate parameters for signature validation', async () => {
    const req = new Request('https://example.com/api/webhook', {
      method: 'POST',
      headers: { 'X-Twilio-Signature': 'signature' },
      body: 'CallSid=CA-first&CallSid=CA-second',
    })

    await expect(isValidTwilioWebhook(req)).resolves.toBe(true)
    expect(validateRequest).toHaveBeenCalledWith(
      'auth-token',
      'signature',
      req.url,
      { CallSid: ['CA-first', 'CA-second'] },
    )
  })

  it('fails closed when Twilio rejects or cannot validate a signature', async () => {
    const request = () =>
      new Request('https://example.com/api/webhook', {
        method: 'POST',
        headers: { 'X-Twilio-Signature': 'signature' },
      })

    validateRequest.mockReturnValue(false)
    await expect(isValidTwilioWebhook(request())).resolves.toBe(false)

    validateRequest.mockImplementation(() => {
      throw new Error('validation failed')
    })
    await expect(isValidTwilioWebhook(request())).resolves.toBe(false)
  })

  it('fails closed when the auth token or signature is absent', async () => {
    twilioConfig.authToken = undefined
    await expect(
      isValidTwilioWebhook(new Request('https://example.com/webhook')),
    ).resolves.toBe(false)

    twilioConfig.authToken = 'auth-token'
    await expect(
      isValidTwilioWebhook(new Request('https://example.com/webhook')),
    ).resolves.toBe(false)
    expect(validateRequest).not.toHaveBeenCalled()
  })
})
