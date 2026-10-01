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

  it('waits until the wizard opens to import the current lead', () => {
    useMockupStore.getState().initialize('rep:1')
    expect(useMockupStore.getState().state.started).toBe(false)
    useMockupStore.getState().start({ entityName: 'Later entered advertiser' })
    expect(useMockupStore.getState().state.intake.advertiser).toBe(
      'Later entered advertiser',
    )
    useMockupStore.getState().start()
    expect(useMockupStore.getState().state.started).toBe(true)
    expect(useMockupStore.getState().state.intake.advertiser).toBeNull()
  })
  it('restores only this authenticated session, never an old advertiser after logout/login', () => {
    useMockupStore.getState().initialize('rep:1')
    useMockupStore.getState().start({ entityName: 'Alpine' })
    useMockupStore.setState({ sessionKey: null })
    useMockupStore.getState().initialize('rep:1')
    expect(useMockupStore.getState().state.intake.advertiser).toBe('Alpine')
    useMockupStore.getState().initialize('rep:2')
    expect(useMockupStore.getState().state.intake.advertiser).toBeNull()
  })
})
