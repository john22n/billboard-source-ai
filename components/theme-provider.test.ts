import type { ReactElement, ReactNode } from 'react'
import type { ThemeProviderProps } from 'next-themes'
import { describe, expect, it } from 'vitest'
import { ThemeProvider } from './theme-provider'

describe('ThemeProvider', () => {
  it('forces light mode without mounting a theme shortcut', () => {
    const children = 'App content'
    const provider = ThemeProvider({ children }) as ReactElement<
      ThemeProviderProps & { children: ReactNode }
    >

    expect(provider.props).toMatchObject({
      attribute: 'class',
      forcedTheme: 'light',
      enableSystem: false,
    })
    expect(provider.props.children).toBe(children)
  })
})
