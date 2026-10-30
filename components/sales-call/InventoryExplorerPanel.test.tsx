// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { InventoryExplorerPanel } from './InventoryExplorerPanel'

it('accepts only versioned Create Typical requests from its trusted inventory frame', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const openProposal = vi.fn()
  const message = {
    type: 'gpp:create-typical',
    version: 1,
    generatorUrl: 'https://geopoepoe.com/gpp/v3/proposal-generator',
    boardIds: [12, 1],
    count: 2,
  }
  try {
    await act(async () =>
      root.render(<InventoryExplorerPanel onCreateTypical={openProposal} />),
    )
    const frame = container.querySelector('iframe')!.contentWindow!
    const acknowledge = vi.spyOn(frame, 'postMessage')
    const send = async (
      data: unknown,
      origin = 'https://geopoepoe.com',
      source: Window = frame,
    ) => {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', { data, origin, source }),
        )
      })
    }
    await send(message, 'https://geopoepoe.com.evil.test')
    await send(message, 'https://geopoepoe.com', window)
    await send(null)
    await send({ ...message, version: 2 })
    await send({ ...message, type: 'unrelated' })
    await send({
      ...message,
      generatorUrl: 'https://geopoepoe.com.evil.test/generator',
    })
    await send({ ...message, generatorUrl: 'javascript:alert(1)' })
    await send({ ...message, generatorUrl: 123 })
    expect(openProposal).not.toHaveBeenCalled()
    expect(acknowledge).not.toHaveBeenCalled()

    await send(message)
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(
      { type: 'gpp:create-typical-ack', version: 1 },
      'https://geopoepoe.com',
    )
    expect(openProposal).toHaveBeenCalledExactlyOnceWith(message.generatorUrl)
    await act(async () => root.unmount())
    await send(message)
    expect(openProposal).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
