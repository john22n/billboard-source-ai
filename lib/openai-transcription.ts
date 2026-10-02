export const REALTIME_TRANSCRIPTION_MODEL = 'gpt-live-transcribe'
export const FILE_TRANSCRIPTION_MODEL = 'gpt-transcribe'

export function transcriptionSession(language = 'en', prompt?: string) {
  return {
    type: 'transcription',
    audio: {
      input: {
        transcription: {
          model: REALTIME_TRANSCRIPTION_MODEL,
          languages: [language],
          prompt:
            prompt ||
            'A Billboard Source sales call about billboard advertising, OOH, CPM, impressions, and Nutshell.',
        },
        noise_reduction: { type: 'near_field' },
        // gpt-live-transcribe requires client-side turn detection.
        turn_detection: null,
      },
    },
  }
}
