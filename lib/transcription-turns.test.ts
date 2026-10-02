import { afterEach, expect, it, vi } from 'vitest'
import { watchTranscriptionTurns } from './transcription-turns'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('bounds continuous speech turns and cleans up without committing to a closed channel', async () => {
  vi.useFakeTimers()
  const disconnect = vi.fn()
  const close = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal(
    'AudioContext',
    class {
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect })
      createAnalyser = () => ({
        fftSize: 2048,
        getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.2),
      })
      resume = vi.fn().mockResolvedValue(undefined)
      close = close
    },
  )
  const channel = { readyState: 'open', send: vi.fn() }
  const stop = await watchTranscriptionTurns(
    {} as MediaStream,
    channel as unknown as RTCDataChannel,
  )
  await vi.advanceTimersByTimeAsync(15000)
  expect(channel.send).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(50)
  expect(channel.send).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({ type: 'input_audio_buffer.commit' }),
  )
  await vi.advanceTimersByTimeAsync(500)
  channel.readyState = 'closed'
  expect(stop()).toBe(false)
  expect(stop()).toBe(false)
  await vi.advanceTimersByTimeAsync(30000)
  expect(channel.send).toHaveBeenCalledTimes(1)
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledTimes(1)
})
