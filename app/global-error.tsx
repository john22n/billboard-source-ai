'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global application error:', error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            padding: '16px',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#111' }}>
              Something went wrong
            </h2>
            <p style={{ marginTop: '8px', color: '#666' }}>
              A critical error occurred. Please refresh the page.
            </p>
            {error.digest && (
              <p style={{ marginTop: '4px', fontSize: '14px', color: '#999' }}>
                Error ID: {error.digest}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={reset}
              style={{
                padding: '8px 16px',
                backgroundColor: '#111',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Try again
            </button>
            <button
              onClick={() => (window.location.href = '/')}
              style={{
                padding: '8px 16px',
                backgroundColor: '#fff',
                color: '#111',
                border: '1px solid #ddd',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Go home
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
