'use client'

import { useState, useEffect } from "react"

interface SplineViewerProps {
  scene: string
}

export function SplineViewer({ scene }: SplineViewerProps) {
  const [SplineComponent, setSplineComponent] = useState<React.ComponentType<{ scene: string }> | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Dynamically import Spline only on client side
    import("@splinetool/react-spline")
      .then((mod) => {
        setSplineComponent(() => mod.default)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error("Failed to load Spline:", err)
        setIsLoading(false)
      })
  }, [])

  if (isLoading || !SplineComponent) {
    return (
      <div className="h-full w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 animate-pulse" />
    )
  }

  return <SplineComponent scene={scene} />
}
