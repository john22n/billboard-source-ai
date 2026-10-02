import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, test } from 'playwright/test'

test('transcription endpoints reject anonymous browser requests', async ({
  page,
}) => {
  await page.goto('/login')
  const result = await page.evaluate(async () => {
    const token = await fetch('/api/token')
    const upload = await fetch('/api/transcribe-file', {
      method: 'POST',
      body: new FormData(),
    })
    return { token: token.status, upload: upload.status }
  })
  expect(result).toEqual({ token: 401, upload: 401 })
})

test('client turn detection commits speech, ignores silence, and preserves call tracks', async ({
  page,
}) => {
  // Run the production helper against real Chromium Web Audio. Only the OpenAI
  // data channel is a test double; no credentials, Twilio call, or DB are used.
  const source = ts.transpileModule(
    readFileSync('lib/transcription-turns.ts', 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText
  await page.route('**/__test/transcription-turns.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: source,
    }),
  )
  await page.goto('/login')
  await page.getByRole('heading', { name: 'Login to your account' }).click()
  const result = await page.evaluate(async () => {
    const modulePath = '/__test/transcription-turns.js'
    const { watchTranscriptionTurns } = await import(modulePath)
    const context = new AudioContext()
    await context.resume()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const destination = context.createMediaStreamDestination()
    oscillator.connect(gain).connect(destination)
    gain.gain.value = 0
    oscillator.start()
    const messages: string[] = []
    const stop = await watchTranscriptionTurns(destination.stream, {
      readyState: 'open',
      send: (message: string) => messages.push(message),
    })
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms))
    try {
      await wait(1200)
      const silenceCount = messages.length
      gain.gain.value = 0.2
      await wait(300)
      gain.gain.value = 0
      await wait(1400)
      const afterSpeech = [...messages]
      await wait(1200)
      const afterSilence = messages.length
      gain.gain.value = 0.2
      await wait(300)
      const flushed = stop()
      const duplicateFlush = stop()
      await wait(1200)
      return {
        silenceCount,
        afterSpeech,
        afterSilence,
        flushed,
        duplicateFlush,
        messages,
        trackState: destination.stream.getAudioTracks()[0].readyState,
      }
    } finally {
      stop()
      oscillator.stop()
      destination.stream.getTracks().forEach((track) => track.stop())
      await context.close()
    }
  })
  expect(result.silenceCount).toBe(0)
  expect(result.afterSpeech.map((message) => JSON.parse(message))).toEqual([
    { type: 'input_audio_buffer.commit' },
  ])
  expect(result.afterSilence).toBe(1)
  expect(result.flushed).toBe(true)
  expect(result.duplicateFlush).toBe(false)
  expect(result.messages).toHaveLength(2)
  expect(result.trackState).toBe('live')
})
