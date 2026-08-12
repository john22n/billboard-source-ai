import {
  getAllUsers,
  getUserCosts,
  getNutshellLeadStats,
  getMainCallsTotal,
  getCurrentOpenAICostRange,
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

  let users: Awaited<ReturnType<typeof getAllUsers>> = []
  let userCosts: Awaited<ReturnType<typeof getUserCosts>> = []
  let leadStats = null
  let mainCallsTotal = 0
  const today = new Date().toISOString().split('T')[0]
  let userCostStartDate = today
  let userCostEndDate = today

  try {
    const userCostRange = getCurrentOpenAICostRange()
    const adminData = await Promise.all([
      getAllUsers(),
      getUserCosts(userCostRange),
      getNutshellLeadStats().catch(() => null),
      getMainCallsTotal().catch(() => 0),
    ])
    ;[users, userCosts, leadStats, mainCallsTotal] = adminData
    userCostStartDate = userCostRange.startDate.toISOString().split('T')[0]
    userCostEndDate = userCostRange.endDate.toISOString().split('T')[0]
  } catch (error) {
    console.error('Failed to fetch admin data:', error)
  }

  return (
    <AdminClient
      initialUsers={users || []}
      initialCosts={userCosts || []}
      initialLeadStats={leadStats}
      mainCallsTotal={mainCallsTotal}
      sessionEmail={session.email}
      sessionIssuedAt={session.issuedAt}
      userCostStartDate={userCostStartDate}
      userCostEndDate={userCostEndDate}
    />
  )
}
