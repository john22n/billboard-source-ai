import {
  getAllUsers,
  getUserCosts,
  getNutshellLeadStats,
  getMainCallsTotal,
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
    const [users, userCosts, leadStats, mainCallsTotal] = await Promise.all([
      getAllUsers(),
      getUserCosts(),
      getNutshellLeadStats().catch(() => null),
      getMainCallsTotal().catch(() => 0),
    ])

    return (
      <AdminClient
        initialUsers={users || []}
        initialCosts={userCosts || []}
        initialLeadStats={leadStats}
        mainCallsTotal={mainCallsTotal}
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
        mainCallsTotal={0}
        sessionEmail={session.email}
      />
    )
  }
}
