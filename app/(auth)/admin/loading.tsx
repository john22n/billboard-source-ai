import { Skeleton } from '@/components/ui/skeleton'

export default function AdminLoading() {
  return (
    <main
      className="flex min-h-svh w-full flex-col gap-5 bg-primary-foreground p-4 md:p-8"
      aria-label="Loading admin panel"
    >
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-32" />
      </div>
      <Skeleton className="h-9 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </main>
  )
}
