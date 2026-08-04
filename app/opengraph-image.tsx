import { ImageResponse } from 'next/og'

export const alt = 'Billboard Source AI'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: '#fff8ef',
        color: '#171717',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        padding: '80px',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ color: '#ff5a00', fontSize: 30, fontWeight: 600 }}>
          Billboard Source
        </div>
        <div style={{ fontSize: 72, fontWeight: 700 }}>Billboard Source AI</div>
        <div style={{ color: '#5f6368', fontSize: 32 }}>
          Real-time transcription and AI-powered lead data extraction
        </div>
      </div>
    </div>,
    size,
  )
}
