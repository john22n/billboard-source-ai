'use client'

import { create } from 'zustand'
import { openingMessage, restart, type MockupState } from '@/lib/mockup/state'

const STORAGE = 'billboard-active-mockup'
type Store = {
  state: MockupState
  sessionKey: string | null
  epoch: number
  busy: boolean
  preparingFiles: boolean
  pdfSource: File | null
  draft: string
  error: string
  /** A message the wizard should send on the rep's behalf, such as "Start". */
  opening: string | null
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

const idle = {
  busy: false,
  preparingFiles: false,
  pdfSource: null,
  draft: '',
  error: '',
  opening: null,
}

export const useMockupStore = create<Store>((set, get) => ({
  state: restart(),
  sessionKey: null,
  epoch: 0,
  ...idle,
  setDraft: (draft) => set({ draft }),
  storageWarning: '',
  initialize(key) {
    if (get().sessionKey === key) return
    let state = restart()
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE) || 'null')
      if (saved?.key === key && Array.isArray(saved.state?.messages))
        state = { ...state, ...saved.state }
      else sessionStorage.removeItem(STORAGE)
    } catch {
      // A browser can deny access entirely. update() reports the persistence warning.
    }
    state.attachments = state.attachments.slice(0, 1)
    set({ sessionKey: key, state, epoch: get().epoch + 1, ...idle })
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
  /** "Start" always discards the previous advertiser, image and references. */
  start(lead) {
    set({ epoch: get().epoch + 1, ...idle, opening: openingMessage(lead) })
    get().update(restart())
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
      ...idle,
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
