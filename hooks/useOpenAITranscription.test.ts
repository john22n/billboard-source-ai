// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { Call } from '@twilio/voice-sdk'

const turns = vi.hoisted(() => ({ watch: vi.fn() }))
vi.mock('@/lib/transcription-turns', () => ({
  watchTranscriptionTurns: turns.watch,
}))
import { useOpenAITranscription } from './useOpenAITranscription'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('waits for every outstanding transcript at hangup without overriding the model', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const channel = {
    onopen: async () => {},
    onmessage: vi.fn<(event: { data: string }) => void>(),
    send: vi.fn(),
    close: vi.fn(),
  }
  const close = vi.fn()
  vi.stubGlobal(
    'RTCPeerConnection',
    class {
      addTrack = vi.fn()
      createDataChannel = () => channel
      createOffer = async () => ({ sdp: 'test-offer' })
      setLocalDescription = vi.fn()
      setRemoteDescription = vi.fn()
      close = close
    },
  )
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ value: 'test-token' }),
    })
    .mockResolvedValueOnce({ ok: true, text: async () => 'test-answer' })
  vi.stubGlobal('fetch', fetchMock)
  let commit: () => void = () => {}
  turns.watch.mockImplementation(async (_stream, _channel, onCommit) => {
    commit = onCommit
    return () => false // Last audio was already committed before hangup.
  })
  let hook: ReturnType<typeof useOpenAITranscription>
  const container = document.createElement('div')
  const root = createRoot(container)
  function Harness() {
    hook = useOpenAITranscription()
    return null
  }
  try {
    await act(async () => {
      root.render(createElement(Harness))
    })
    await act(async () => {
      await hook.startTranscription({
        getRemoteStream: () => ({ getAudioTracks: () => [{}] }),
        getLocalStream: () => null,
      } as unknown as Call)
      await channel.onopen()
    })
    expect(channel.send).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.openai.com/v1/realtime/calls',
    )
    commit()
    commit()
    let stopped: Promise<void>
    await act(async () => {
      stopped = hook.stopTranscription()
    })
    expect(close).not.toHaveBeenCalled()
    await act(async () => {
      channel.onmessage({
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'turn-2',
          transcript: 'Second turn.',
        }),
      })
    })
    expect(close).not.toHaveBeenCalled()
    await act(async () => {
      channel.onmessage({
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'turn-1',
          transcript: 'First turn.',
        }),
      })
      await stopped
    })
    expect(close).toHaveBeenCalledTimes(1)
    expect(
      hook!.transcripts.map((item) => [item.id, item.text, item.speaker]),
    ).toEqual([
      ['turn-2', 'Second turn.', 'caller'],
      ['turn-1', 'First turn.', 'caller'],
    ])
  } finally {
    await act(async () => root.unmount())
  }
})
