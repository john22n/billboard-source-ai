'use client'

import { useEffect } from 'react'
import {
  ThemeProvider as NextThemesProvider,
  useTheme,
  type ThemeProviderProps,
} from 'next-themes'

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const editableTags = ['INPUT', 'TEXTAREA', 'SELECT']
  return editableTags.includes(target.tagName) || target.isContentEditable
}

export function shouldIgnoreThemeHotkey(event: KeyboardEvent) {
  if (typeof event.key !== 'string') return true

  const hasModifier = [event.metaKey, event.ctrlKey, event.altKey].some(Boolean)
  return (
    event.key.toLowerCase() !== 'd' ||
    hasModifier ||
    isEditableTarget(event.target)
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    const toggleTheme = (event: KeyboardEvent) => {
      if (shouldIgnoreThemeHotkey(event)) return

      setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
    }

    window.addEventListener('keydown', toggleTheme)
    return () => window.removeEventListener('keydown', toggleTheme)
  }, [resolvedTheme, setTheme])

  return null
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}
