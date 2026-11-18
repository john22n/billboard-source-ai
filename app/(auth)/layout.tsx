import { TwilioProvider } from '@/components/providers/TwilioProvider'
import { WorkerStatusProvider } from '@/hooks/useWorkerStatus'
import { LeadNotifications } from '@/components/lead-notifications'
import { getSession } from '@/lib/auth'
import { serverConfig } from '@/lib/config'
import { AvailableWorkersProvider } from '@/hooks/useAvailableWorkers'

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  const showNotifications =
    session && serverConfig.nutshell.notificationsEnabled
  return (
    <WorkerStatusProvider>
      <AvailableWorkersProvider>
        <TwilioProvider>
          {children}
          {showNotifications && (
            <LeadNotifications key={session.userId} userId={session.userId} />
          )}
        </TwilioProvider>
      </AvailableWorkersProvider>
    </WorkerStatusProvider>
  )
}
