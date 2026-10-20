// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useMockupStore } from './mockupStore'

beforeEach(() => {
  useMockupStore.getState().clear()
  sessionStorage.clear()
})

describe('active mockup lifecycle', () => {
  it('never queues an opening for a fresh or restored session', () => {
    useMockupStore.getState().initialize('rep:1')
    expect(useMockupStore.getState().opening).toBeNull()
    useMockupStore.getState().initialize('rep:1')
    expect(useMockupStore.getState().opening).toBeNull()
    useMockupStore.getState().update({
      messages: [{ role: 'assistant', text: 'What is the advertiser’s name?' }],
    })
    useMockupStore.setState({ sessionKey: null })
    useMockupStore.getState().initialize('rep:1')
    expect(useMockupStore.getState().opening).toBeNull()
    expect(useMockupStore.getState().state.messages).toHaveLength(1)
  })

  it('remembers the exact created lead for attachment retry and does not invent a lead ID', () => {
    useMockupStore.getState().initialize('rep:1')
    useMockupStore
      .getState()
      .recordSubmittedLead(42, 'Alpine', true, 'lead-42-receipt')
    useMockupStore.setState({ sessionKey: null })
    useMockupStore.getState().initialize('rep:1')
    expect(useMockupStore.getState().state).toMatchObject({
      lastLead: {
        id: 42,
        name: 'Alpine',
        advertiser: 'Alpine',
        receipt: 'lead-42-receipt',
      },
      attachmentFailed: true,
    })
    useMockupStore.getState().recordSubmittedLead(undefined, 'Other', false)
    expect(useMockupStore.getState().state.lastLead?.id).toBe(42)
    expect(useMockupStore.getState().state.attachmentFailed).toBe(true)
  })

  it('queues a new opening after an explicit reset and clears the previous conversation', () => {
    useMockupStore.getState().initialize('rep:1')
    useMockupStore.setState({ opening: null })
    useMockupStore.getState().update({
      messages: [{ role: 'assistant', text: 'Old question' }],
    })
    useMockupStore.setState({ draft: 'half-typed', error: 'old failure' })
    useMockupStore.getState().start()
    expect(useMockupStore.getState().opening).toBe('Start')
    expect(useMockupStore.getState().state.messages).toEqual([])
    expect(useMockupStore.getState().draft).toBe('')
    expect(useMockupStore.getState().error).toBe('')
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
