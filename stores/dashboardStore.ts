import { create } from 'zustand'

// Shared by the dashboard tab row and its left sidebar; never persisted.
export const useDashboardStore = create<{
  activeTab: string
  transcriptStartedAt: number | null
  setActiveTab: (tab: string) => void
}>((set) => ({
  activeTab: 'form',
  transcriptStartedAt: null,
  setActiveTab: (activeTab) => set({ activeTab }),
}))
