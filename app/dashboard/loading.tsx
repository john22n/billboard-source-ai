import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardLoading() {
  return (
    <div className="flex h-screen w-full">
      {/* Sidebar skeleton */}
      <div className="hidden md:flex w-72 flex-col border-r bg-background p-4">
        <Skeleton className="h-8 w-32 mb-6" />
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="flex-1 flex flex-col">
        {/* Header skeleton */}
        <div className="h-12 border-b flex items-center px-4">
          <Skeleton className="h-6 w-48" />
        </div>

        {/* Content area skeleton */}
        <div className="flex-1 p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left panel - Transcription */}
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-[400px] w-full rounded-lg" />
          </div>

          {/* Right panel - Form */}
          <div className="space-y-4">
            <Skeleton className="h-8 w-32" />
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
