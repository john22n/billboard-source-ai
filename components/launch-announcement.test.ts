// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LaunchAnnouncement } from './launch-announcement'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T18:00:00Z'))
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

it('keeps the dashboard announcement visible until one minute has elapsed', () => {
  act(() =>
    root.render(createElement(LaunchAnnouncement, { autoDismiss: true })),
  )
  act(() => vi.advanceTimersByTime(59999))
  expect(container.textContent).toContain('GeoPoePoe3')
  act(() => vi.advanceTimersByTime(1))
  expect(container.querySelector('aside')).toBeNull()
})

it('leaves the login announcement visible until manually dismissed', () => {
  act(() => root.render(createElement(LaunchAnnouncement)))
  act(() => vi.advanceTimersByTime(60000))
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
  expect(vi.getTimerCount()).toBe(1) // Only the launch-date expiry timer remains.
})

it('expires an open login announcement at midnight after October 20 in Denver', () => {
  vi.setSystemTime(new Date('2026-10-21T05:59:59.999Z'))
  act(() => root.render(createElement(LaunchAnnouncement)))
  expect(container.textContent).toContain('GeoPoePoe3')
  act(() => vi.advanceTimersByTime(1))
  expect(container.querySelector('aside')).toBeNull()
})

it.each([false, true])(
  'does not show after expiry with autoDismiss=%s',
  (autoDismiss) => {
    vi.setSystemTime(new Date('2026-10-21T06:00:00Z'))
    act(() => root.render(createElement(LaunchAnnouncement, { autoDismiss })))
    expect(container.querySelector('aside')).toBeNull()
  },
)

it('supports visits more than the browser timer limit before expiry', () => {
  vi.setSystemTime(new Date('2026-09-01T06:00:00Z'))
  act(() => root.render(createElement(LaunchAnnouncement)))
  act(() => vi.advanceTimersByTime(2147483647))
  expect(container.textContent).toContain('GeoPoePoe3')
  act(() =>
    vi.advanceTimersByTime(
      new Date('2026-10-21T06:00:00Z').getTime() - Date.now(),
    ),
  )
  expect(container.querySelector('aside')).toBeNull()
})
