'use client'
import { TwilioProvider } from '@/components/providers/TwilioProvider'
import { WorkerStatusProvider } from '@/hooks/useWorkerStatus'
import { AvailableWorkersProvider } from '@/hooks/useAvailableWorkers'

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <WorkerStatusProvider>
      <AvailableWorkersProvider>
        <TwilioProvider>{children}</TwilioProvider>
      </AvailableWorkersProvider>
    </WorkerStatusProvider>
  )
}
