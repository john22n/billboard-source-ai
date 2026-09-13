import { describe, expect, it, vi } from 'vitest'
import {
  getVoicemailAITranscripts,
  transcribeVoicemailAIRecording,
} from './voicemail-ai-transcripts'

function fixture() {
  const sentences = vi.fn().mockResolvedValue([
    {
      startTime: '10.0',
      sentenceIndex: 2,
      mediaChannel: 2,
      transcript: 'We will call tomorrow.',
    },
    {
      startTime: '2.0',
      sentenceIndex: 1,
      mediaChannel: 1,
      transcript: 'Please call me back.',
    },
  ])
  const transcripts = Object.assign(
    vi.fn(() => ({ sentences: { list: sentences } })),
    {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ sid: 'GT1' }),
    },
  )
  const services = vi.fn(() => ({
    fetch: vi.fn().mockResolvedValue({ sid: 'GA1' }),
  }))
  return {
    client: { intelligence: { v2: { transcripts, services } } } as never,
    transcripts,
    sentences,
    services,
  }
}

describe('voicemail AI Intelligence transcripts', () => {
  it('creates a recording-scoped transcript and does not duplicate retried callbacks', async () => {
    const f = fixture()
    await transcribeVoicemailAIRecording(f.client, 'CA1', 'RE1')
    expect(f.services).toHaveBeenCalledWith('weekend-voicemail-ai')
    expect(f.transcripts.create).toHaveBeenCalledWith({
      serviceSid: 'GA1',
      customerKey: 'CA1',
      channel: { media_properties: { source_sid: 'RE1' } },
    })
    f.transcripts.list.mockResolvedValue([{ sid: 'GT1' }])
    await transcribeVoicemailAIRecording(f.client, 'CA1', 'RE1')
    expect(f.transcripts.create).toHaveBeenCalledTimes(1)
    expect(f.transcripts.list).toHaveBeenLastCalledWith({
      sourceSid: 'RE1',
      limit: 1,
    })
  })

  it('accepts a concurrent create but surfaces a real creation failure', async () => {
    const f = fixture()
    f.transcripts.create.mockRejectedValue(new Error('create failed'))
    f.transcripts.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sid: 'GT1' }])
    await expect(
      transcribeVoicemailAIRecording(f.client, 'CA1', 'RE1'),
    ).resolves.toBeUndefined()
    await expect(
      transcribeVoicemailAIRecording(f.client, 'CA1', 'RE1'),
    ).rejects.toThrow('create failed')
  })

  it('returns chronological text from both channels for the requested recording only', async () => {
    const f = fixture()
    f.transcripts.list.mockResolvedValue([{ sid: 'GT1', status: 'completed' }])
    const warnings: string[] = []
    expect(await getVoicemailAITranscripts(f.client, 'RE1', warnings)).toEqual([
      {
        sid: 'GT1',
        status: 'completed',
        text: 'Channel 1: Please call me back.\nChannel 2: We will call tomorrow.',
      },
    ])
    expect(f.transcripts.list).toHaveBeenCalledWith({
      sourceSid: 'RE1',
      limit: 1,
    })
    expect(f.transcripts).toHaveBeenCalledWith('GT1')
    expect(warnings).toEqual([])
  })

  it.each(['queued', 'in-progress', 'failed', 'canceled'])(
    'preserves %s status without attempting to read unavailable sentences',
    async (status) => {
      const f = fixture()
      f.transcripts.list.mockResolvedValue([{ sid: 'GT1', status }])
      expect(await getVoicemailAITranscripts(f.client, 'RE1', [])).toEqual([
        { sid: 'GT1', status, text: '' },
      ])
      expect(f.sentences).not.toHaveBeenCalled()
    },
  )

  it('reports API failure and truncation rather than silently claiming no transcript', async () => {
    const f = fixture()
    const warnings: string[] = []
    f.transcripts.list.mockRejectedValueOnce(new Error('unavailable'))
    expect(await getVoicemailAITranscripts(f.client, 'RE1', warnings)).toEqual(
      [],
    )
    expect(warnings[0]).toContain('unavailable')
    f.transcripts.list.mockResolvedValue([{ sid: 'GT1', status: 'completed' }])
    f.sentences.mockResolvedValue(
      Array.from({ length: 1000 }, (_, i) => ({
        startTime: String(i),
        sentenceIndex: i,
        mediaChannel: 1,
        transcript: 'Text',
      })),
    )
    await getVoicemailAITranscripts(f.client, 'RE1', warnings)
    expect(warnings[1]).toContain('first 1000')
  })
})
