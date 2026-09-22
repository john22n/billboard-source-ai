import { create } from 'zustand'

// Shared by the dashboard tab row and its left sidebar; never persisted.
export const useDashboardStore = create<{
  activeTab: string
  setActiveTab: (tab: string) => void
}>((set) => ({
  activeTab: 'form',
  setActiveTab: (activeTab) => set({ activeTab }),
}))
