"use client"

import dynamic from "next/dynamic"

function DashboardSkeleton() {
  return (
    <div className="h-full animate-pulse">
      <div className="h-full max-w-[1800px] mx-auto flex flex-col">
        <div className="bg-white rounded-lg shadow-2xl h-full flex flex-col">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 h-20 rounded-t-lg" />
          <div className="flex-1 p-4 space-y-4">
            <div className="h-10 bg-slate-200 rounded w-full" />
            <div className="flex gap-4 flex-1">
              <div className="flex-[2] bg-slate-100 rounded-lg" />
              <div className="w-96 bg-slate-100 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Dynamic import to prevent hydration mismatch from Radix Tabs
const SalesCallTranscriber = dynamic(
  () => import("@/components/SalesCallTranscriber"),
  { 
    ssr: false,
    loading: () => <DashboardSkeleton />
  }
)

export function SalesCallTranscriberWrapper() {
  return <SalesCallTranscriber />
}