// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LaunchAnnouncement } from './launch-announcement'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps the dashboard announcement visible until five seconds have elapsed', () => {
  act(() =>
    root.render(createElement(LaunchAnnouncement, { autoDismiss: true })),
  )
  act(() => vi.advanceTimersByTime(4999))
  expect(container.textContent).toContain('GeoPoePoe3')
  act(() => vi.advanceTimersByTime(1))
  expect(container.querySelector('aside')).toBeNull()
})

it('leaves the login announcement visible until manually dismissed', () => {
  act(() => root.render(createElement(LaunchAnnouncement)))
  act(() => vi.advanceTimersByTime(10000))
  expect(container.textContent).toContain('GeoPoePoe3')
  act(() => container.querySelector('button')!.click())
  expect(container.querySelector('aside')).toBeNull()
})

it('cancels the dashboard timer when dismissed early', () => {
  act(() =>
    root.render(createElement(LaunchAnnouncement, { autoDismiss: true })),
  )
  act(() => vi.advanceTimersByTime(1000))
  act(() => container.querySelector('button')!.click())
  expect(container.querySelector('aside')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})
