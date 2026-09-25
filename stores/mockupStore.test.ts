// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useMockupStore } from './mockupStore'

beforeEach(() => {
  useMockupStore.getState().clear()
  sessionStorage.clear()
})

describe('active mockup lifecycle', () => {
  it('remembers the exact created lead for attachment retry and does not invent a lead ID', () => {
    useMockupStore.getState().recordSubmittedLead(42, 'Alpine', true)
    expect(useMockupStore.getState().state).toMatchObject({
      lastLead: { id: 42, name: 'Alpine', advertiser: 'Alpine' },
      attachmentFailed: true,
    })
    useMockupStore.getState().recordSubmittedLead(undefined, 'Other', false)
    expect(useMockupStore.getState().state.lastLead?.id).toBe(42)
    expect(useMockupStore.getState().state.attachmentFailed).toBe(true)
  })

  it('queues an opening message that carries the current lead, and a plain Start without one', () => {
    useMockupStore.getState().initialize('rep:1')
    expect(useMockupStore.getState().opening).toBeNull()
    useMockupStore.getState().update({
      messages: [{ role: 'assistant', text: 'Old question' }],
    })
    useMockupStore.setState({ draft: 'half-typed', error: 'old failure' })
    useMockupStore.getState().start({ entityName: 'Later entered advertiser' })
    expect(useMockupStore.getState().opening).toContain(
      'Advertiser: Later entered advertiser',
    )
    expect(useMockupStore.getState().state.messages).toEqual([])
    expect(useMockupStore.getState().draft).toBe('')
    expect(useMockupStore.getState().error).toBe('')
    useMockupStore.getState().start()
    expect(useMockupStore.getState().opening).toBe('Start')
  })

  it('restores only this authenticated session, never an old advertiser after logout/login', () => {
    useMockupStore.getState().initialize('rep:1')
    useMockupStore.getState().update({
      messages: [{ role: 'user', text: 'Alpine' }],
    })
    useMockupStore.setState({ sessionKey: null })
    useMockupStore.getState().initialize('rep:1')
    expect(useMockupStore.getState().state.messages).toEqual([
      { role: 'user', text: 'Alpine' },
    ])
    useMockupStore.getState().initialize('rep:2')
    expect(useMockupStore.getState().state.messages).toEqual([])
  })
})
