// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import ErrorPage from './error'
import GlobalError from './global-error'

it.each([ErrorPage, GlobalError])(
  '%s offers a home link even without router context',
  (Component) => {
    const markup = renderToStaticMarkup(
      createElement(Component, {
        error: new Error('Test error'),
        reset: vi.fn(),
      }),
    )
    const document = new DOMParser().parseFromString(markup, 'text/html')
    expect(document.links).toHaveLength(1)
    expect(document.links[0].textContent).toBe('Go home')
    expect(document.links[0].getAttribute('href')).toBe('/')
    expect(document.body.textContent).toContain('Try again')
  },
)
