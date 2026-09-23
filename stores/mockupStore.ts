'use client'

import { create } from 'zustand'
import { importLead, restart, type MockupState } from '@/lib/mockup/intake'

const STORAGE = 'billboard-active-mockup'
type Store = {
  state: MockupState
  sessionKey: string | null
  epoch: number
  busy: boolean
  draft: string
  error: string
  setDraft: (draft: string) => void
  storageWarning: string
  initialize: (key: string) => void
  update: (change: Partial<MockupState>) => void
  recordSubmittedLead: (
    id: number | undefined,
    advertiser: string | null | undefined,
    attachmentFailed: boolean,
  ) => void
  start: (lead?: Record<string, unknown>) => void
  clear: () => void
}

export const useMockupStore = create<Store>((set, get) => ({
  state: restart(),
  sessionKey: null,
  epoch: 0,
  busy: false,
  draft: '',
  error: '',
  setDraft: (draft) => set({ draft }),
  storageWarning: '',
  initialize(key) {
    if (get().sessionKey === key) return
    let state = { ...restart(), started: false }
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE) || 'null')
      if (
        saved?.key === key &&
        saved.state?.intake &&
        Array.isArray(saved.state.messages)
      )
        state = saved.state
      else sessionStorage.removeItem(STORAGE)
    } catch {
      // A browser can deny access entirely. update() reports the persistence warning.
    }
    set({
      sessionKey: key,
      state,
      epoch: get().epoch + 1,
      busy: false,
      draft: '',
      error: '',
    })
    get().update({})
  },
  update(change) {
    const state = { ...get().state, ...change }
    set({ state })
    if (!get().sessionKey) return
    try {
      sessionStorage.setItem(
        STORAGE,
        JSON.stringify({ key: get().sessionKey, state }),
      )
      set({ storageWarning: '' })
    } catch {
      set({
        storageWarning:
          'This browser could not preserve the mockup for refresh. Download the image before leaving this page.',
      })
    }
  },
  recordSubmittedLead(id, advertiser, attachmentFailed) {
    if (!id) return
    get().update({
      lastLead: {
        id: Number(id),
        name: advertiser || 'Submitted lead',
        advertiser: advertiser || '',
      },
      attachmentFailed,
    })
  },
  start(lead) {
    set({ epoch: get().epoch + 1, busy: false, draft: '', error: '' })
    get().update({
      ...restart(),
      ...(lead ? { intake: importLead(lead) } : {}),
    })
  },
  clear() {
    try {
      sessionStorage.removeItem(STORAGE)
    } catch {
      // Always clear the active state, including when browser storage is unavailable.
    }
    set({
      state: restart(),
      sessionKey: null,
      epoch: get().epoch + 1,
      busy: false,
      draft: '',
      error: '',
      storageWarning: '',
    })
  },
}))

export function clearMockupSession() {
  useMockupStore.getState().clear()
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('billboard-mockup-logout')
    channel.postMessage('logout')
    channel.close()
  }
}
