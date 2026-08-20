import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import IssueReportClient from './issue-report-client'

export const dynamic = 'force-dynamic'

export default async function IssueReportPage() {
  const session = await getSession()
  if (!session?.userId) redirect('/login')

  return <IssueReportClient reporterEmail={session.email} />
}
