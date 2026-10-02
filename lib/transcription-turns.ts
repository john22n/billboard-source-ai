/** Commit speech after one second of silence, or every 15 seconds of speech.
 * The source belongs to the call: never stop its tracks during cleanup.
 */
export async function watchTranscriptionTurns(
  stream: MediaStream,
  channel: RTCDataChannel,
  onCommit?: () => void,
) {
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  let speechStartedAt = 0
  let lastSpeechAt = 0
  let stopped = false

  const commit = () => {
    if (!speechStartedAt || channel.readyState !== 'open') return false
    channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
    onCommit?.()
    speechStartedAt = 0
    return true
  }

  try {
    await context.resume()
  } catch (error) {
    source.disconnect()
    await context.close()
    throw error
  }

  const timer = setInterval(() => {
    if (channel.readyState !== 'open') return
    analyser.getFloatTimeDomainData(samples)
    const rms = Math.sqrt(
      samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
    )
    const now = performance.now()
    if (rms > 0.01) {
      if (!speechStartedAt) speechStartedAt = now
      lastSpeechAt = now
    }
    if (
      speechStartedAt &&
      (now - lastSpeechAt >= 1000 || now - speechStartedAt >= 15000)
    ) {
      commit()
    }
  }, 50)

  return () => {
    if (stopped) return false
    stopped = true
    clearInterval(timer)
    const committed = commit()
    source.disconnect()
    void context.close()
    return committed
  }
}
