import {
  getAllUsers,
  getUserCosts,
  getNutshellLeadStats,
  getCallAttemptTotals,
} from '@/lib/dal'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import AdminClient from './admin-client'
export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  // Verify user is authenticated and has admin role
  const session = await getSession()
  if (!session?.userId) {
    redirect('/login')
  }

  if (session.role !== 'admin') {
    redirect('/dashboard')
  }

  try {
    const [users, userCosts, leadStats, callAttemptTotals] = await Promise.all([
      getAllUsers(),
      getUserCosts(),
      getNutshellLeadStats().catch(() => null),
      getCallAttemptTotals().catch(() => []),
    ])

    return (
      <AdminClient
        initialUsers={users || []}
        initialCosts={userCosts || []}
        initialLeadStats={leadStats}
        initialCallAttemptTotals={callAttemptTotals || []}
        sessionEmail={session.email}
      />
    )
  } catch (error) {
    console.error('Failed to fetch admin data:', error)

    return (
      <AdminClient
        initialUsers={[]}
        initialCosts={[]}
        initialLeadStats={null}
        sessionEmail={session.email}
      />
    )
  }
}
