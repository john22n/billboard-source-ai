import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldIgnoreThemeHotkey } from './theme-provider'

describe('theme hotkey', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ignores event-like keydown events that do not include a key', () => {
    const event = {
      key: undefined,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      target: null,
    } as unknown as KeyboardEvent

    expect(() => shouldIgnoreThemeHotkey(event)).not.toThrow()
  })

  it('handles an unmodified D key case-insensitively', () => {
    vi.stubGlobal('HTMLElement', class {})
    const event = {
      key: 'D',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      target: null,
    } as unknown as KeyboardEvent

    expect(shouldIgnoreThemeHotkey(event)).toBe(false)
  })
})
