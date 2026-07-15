'use client'
import { TwilioProvider } from '@/components/providers/TwilioProvider'
import { WorkerStatusProvider } from '@/hooks/useWorkerStatus'

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <WorkerStatusProvider>
      <TwilioProvider>{children}</TwilioProvider>
    </WorkerStatusProvider>
  )
}
