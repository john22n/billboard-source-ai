'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-900">
          Something went wrong
        </h2>
        <p className="mt-2 text-gray-600">
          An unexpected error occurred. Please try again.
        </p>
        {error.digest && (
          <p className="mt-1 text-sm text-gray-400">Error ID: {error.digest}</p>
        )}
      </div>
      <div className="flex gap-2">
        <Button onClick={reset} variant="default">
          Try again
        </Button>
        <Button onClick={() => (window.location.href = '/')} variant="outline">
          Go home
        </Button>
      </div>
    </div>
  )
}
