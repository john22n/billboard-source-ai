'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { SignupForm } from '@/components/sign-up'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Trash2,
  Loader2,
  CheckCircle2,
  CircleAlert,
  MessageSquareText,
  RefreshCw,
  DollarSign,
  UserPlus,
} from 'lucide-react'
import {
  deleteUsers,
  updateTwilioPhone,
  resetCallCounts,
} from '@/actions/user-actions'
import { useRouter } from 'next/navigation'
import type { User, NutshellLead, StoredIssueDiagnosis } from '@/db/schema'
import {
  handleApiResponse,
  showErrorToast,
  showSuccessToast,
  getErrorMessage,
} from '@/lib/error-handling'
import { useAutoLogout } from '@/hooks/useAutoLogout'

interface OpenAIUsage {
  totalCost: number
  totalCostFormatted: string
  startDate: string
  endDate: string
}

interface TwilioUsage {
  currentMonth: {
    name: string
    cost: number
    costFormatted: string
  }
  lastMonth: {
    name: string
    cost: number
    costFormatted: string
  }
  totalCost: number
  totalCostFormatted: string
}

interface ReportedIssue {
  reportId: string
  reporterEmail: string
  title: string
  description: string
  occurredAt: string
  diagnosis: StoredIssueDiagnosis
  unavailableSources: string[]
  resolvedAt: string | null
  createdAt: string
}

// Define a type for the cost parameter
type CostValue =
  | string
  | number
  | { toNumber?: () => number; toFixed?: () => string }
  | null
  | undefined

function costToNumber(cost: CostValue): number {
  if (cost == null) return 0
  if (typeof cost === 'number') return cost
  if (typeof cost === 'string') {
    const n = Number(cost)
    return Number.isFinite(n) ? n : 0
  }
  if (typeof cost === 'object') {
    if (typeof cost.toNumber === 'function') return cost.toNumber()
    if (typeof cost.toFixed === 'function') {
      const s = cost.toFixed()
      const n = Number(s)
      return Number.isFinite(n) ? n : 0
    }
  }
  return 0
}

interface UserCost {
  id: string
  email: string
  cost: string | number
}

interface LeadStats {
  leads: NutshellLead[]
  totalLeads: number
  wonCount: number
  openCount: number
  lostCount: number
  totalWonValue: number
}

interface AdminClientProps {
  initialUsers: User[]
  initialCosts: UserCost[]
  initialLeadStats: LeadStats | null
  mainCallsTotal: number
  sessionEmail: string
  sessionIssuedAt: number
  userCostStartDate: string
  userCostEndDate: string
}

type SetState<T> = Dispatch<SetStateAction<T>>

interface WorkerAvailability {
  [userId: string]: {
    avgWorkdayHours?: number
    totalWorkdayHours?: number
    avgDailyHours?: number
  }
}

interface SyncProgress {
  total: number
  synced: number
  errors: number
  message?: string
}

interface SyncEvent {
  type: 'progress' | 'status' | 'done' | 'error'
  total: number
  synced: number
  errors: number
  message?: string
}

function getSseEvent(line: string): SyncEvent | null {
  const dataMatch = line.match(/^data: (.+)$/m)
  return dataMatch ? (JSON.parse(dataMatch[1]) as SyncEvent) : null
}

function processSyncEvent(
  data: SyncEvent,
  setSyncProgress: SetState<SyncProgress | null>,
  refresh: () => void,
) {
  if (data.type === 'progress') {
    setSyncProgress({
      total: data.total,
      synced: data.synced,
      errors: data.errors,
      message: data.message,
    })
  } else if (data.type === 'status') {
    setSyncProgress((prev) => ({
      total: prev?.total ?? 0,
      synced: prev?.synced ?? 0,
      errors: prev?.errors ?? 0,
      message: data.message,
    }))
  } else if (data.type === 'done') {
    showSuccessToast(
      `Synced ${data.synced} leads${data.errors > 0 ? ` (${data.errors} errors)` : ''}`,
    )
    refresh()
  } else if (data.type === 'error') {
    showErrorToast(data.message || 'Sync failed')
  }
}

interface AdminHeaderProps {
  signupOpen: boolean
  setSignupOpen: SetState<boolean>
  handleSignupSuccess: () => void
  handleBackToDashboard: () => void
  selectedUsers: string[]
  isPending: boolean
  handleDelete: () => void
}

function AdminHeader({
  signupOpen,
  setSignupOpen,
  handleSignupSuccess,
  handleBackToDashboard,
  selectedUsers,
  isPending,
  handleDelete,
}: AdminHeaderProps) {
  return (
    <div className="mb-4 flex w-full flex-wrap items-center gap-3 md:flex-nowrap">
      <div className="order-2 flex flex-1 flex-wrap items-center gap-2 md:order-none md:flex-nowrap">
        <Button size="sm" onClick={handleBackToDashboard}>
          back to Dashboard
        </Button>
        <Sheet open={signupOpen} onOpenChange={setSignupOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              <UserPlus data-icon="inline-start" className="mr-2 h-4 w-4" />
              Add Employee
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-full sm:max-w-md overflow-y-auto"
          >
            <SheetHeader>
              <SheetTitle>Add Employee</SheetTitle>
              <SheetDescription>
                Create a new employee account.
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <SignupForm onSuccess={handleSignupSuccess} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
      <h2 className="order-first basis-full text-center text-2xl font-semibold md:order-none md:flex-1 md:basis-auto">
        Admin Panel
      </h2>
      <div className="order-3 flex justify-end gap-2 md:order-none md:flex-1">
        <Button
          variant="destructive"
          size="sm"
          disabled={selectedUsers.length === 0 || isPending}
          onClick={handleDelete}
        >
          <Trash2 data-icon="inline-start" className="mr-2 h-4 w-4" />
          <span aria-live="polite">
            {isPending ? 'Deleting...' : 'Delete Selected'}
          </span>
        </Button>
      </div>
    </div>
  )
}

interface UsersTabProps {
  initialUsers: User[]
  selectedUsers: string[]
  isPending: boolean
  toggleSelect: (id: string) => void
  phoneEdits: Record<string, string>
  setPhoneEdits: SetState<Record<string, string>>
  handlePhoneUpdate: (userId: string, currentValue: string | null) => void
  handleResetCounts: () => void
  mainCallsTotal: number
  availabilityLoading: boolean
  workerAvailability: WorkerAvailability
}

function UsersTab({
  initialUsers,
  selectedUsers,
  isPending,
  toggleSelect,
  phoneEdits,
  setPhoneEdits,
  handlePhoneUpdate,
  handleResetCounts,
  mainCallsTotal,
  availabilityLoading,
  workerAvailability,
}: UsersTabProps) {
  return (
    <TabsContent value="users">
      <Table>
        <TableCaption>Manage registered users.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px] text-center">Select</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Twilio Phone</TableHead>
            <TableHead className="text-right">
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={handleResetCounts}
                >
                  <RefreshCw
                    data-icon="inline-start"
                    className="mr-2 h-4 w-4"
                  />
                  Reset
                </Button>
                <span>
                  Missed / Rejected / Accepted: total=
                  {mainCallsTotal.toLocaleString('en-US')}
                </span>
              </div>
            </TableHead>
            <TableHead className="text-right">Average Workday Hours</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {initialUsers.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center text-muted-foreground"
              >
                No users found
              </TableCell>
            </TableRow>
          ) : (
            initialUsers.map((user, index) => (
              <TableRow key={user.id}>
                <TableCell className="text-center">
                  <Checkbox
                    aria-label="Select user account"
                    checked={selectedUsers.includes(user.id)}
                    onCheckedChange={() => toggleSelect(user.id)}
                    disabled={isPending}
                  />
                </TableCell>
                <TableCell>{index + 1}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.role ?? 'User'}</TableCell>
                <TableCell>
                  <Input
                    type="tel"
                    aria-label="Twilio phone number"
                    autoComplete="tel"
                    className="h-8 w-32"
                    placeholder="+1234567890"
                    value={phoneEdits[user.id] ?? user.twilioPhoneNumber ?? ''}
                    onChange={(e) =>
                      setPhoneEdits((prev) => ({
                        ...prev,
                        [user.id]: e.target.value,
                      }))
                    }
                    onBlur={() =>
                      handlePhoneUpdate(user.id, user.twilioPhoneNumber)
                    }
                    onKeyDown={(e) =>
                      e.key === 'Enter' &&
                      handlePhoneUpdate(user.id, user.twilioPhoneNumber)
                    }
                    disabled={isPending}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className="font-medium">
                    {user.callsMissed ?? 0} / {user.callsRejected ?? 0} /{' '}
                    {user.callsAccepted ?? 0}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {availabilityLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin ml-auto" />
                  ) : workerAvailability[user.id] ? (
                    <span className="font-medium">
                      {(
                        workerAvailability[user.id].avgWorkdayHours ??
                        workerAvailability[user.id].avgDailyHours ??
                        0
                      ).toFixed(1)}
                      h
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TabsContent>
  )
}

interface CostsTabProps {
  initialCosts: UserCost[]
  totalCost: string
  userCostStartDate: string
  userCostEndDate: string
  usageLoading: boolean
  usageError: string | null
  openaiUsage: OpenAIUsage | null
  twilioLoading: boolean
  twilioError: string | null
  twilioUsage: TwilioUsage | null
}

interface OpenAIUsageDisplayProps {
  usageLoading: boolean
  usageError: string | null
  openaiUsage: OpenAIUsage | null
}

function OpenAIUsageDisplay({
  usageLoading,
  usageError,
  openaiUsage,
}: OpenAIUsageDisplayProps) {
  return (
    <div className="mt-6 p-4 bg-muted rounded-lg border">
      <h3 className="text-sm font-semibold mb-2">
        OpenAI Organization Usage (Last 30 Days)
      </h3>
      {usageLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading usage data...</span>
        </div>
      ) : usageError ? (
        <p className="text-sm text-red-500">{usageError}</p>
      ) : openaiUsage ? (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              Actual org API cost
            </span>
            <span className="text-xl font-bold">
              {openaiUsage.totalCostFormatted}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {openaiUsage.startDate} to {openaiUsage.endDate}
          </p>
        </div>
      ) : null}
    </div>
  )
}

interface TwilioUsageDisplayProps {
  twilioLoading: boolean
  twilioError: string | null
  twilioUsage: TwilioUsage | null
}

function TwilioUsageDisplay({
  twilioLoading,
  twilioError,
  twilioUsage,
}: TwilioUsageDisplayProps) {
  return (
    <div className="mt-4 p-4 bg-muted rounded-lg border">
      <h3 className="text-sm font-semibold mb-2">Twilio Usage</h3>
      {twilioLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading Twilio data...</span>
        </div>
      ) : twilioError ? (
        <p className="text-sm text-red-500">{twilioError}</p>
      ) : twilioUsage ? (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {twilioUsage.currentMonth.name} (Current)
            </span>
            <span className="text-lg font-semibold">
              {twilioUsage.currentMonth.costFormatted}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {twilioUsage.lastMonth.name} (Last)
            </span>
            <span className="text-lg font-semibold">
              {twilioUsage.lastMonth.costFormatted}
            </span>
          </div>
          <div className="pt-2 border-t flex justify-between items-center">
            <span className="text-sm font-medium">Total</span>
            <span className="text-xl font-bold">
              {twilioUsage.totalCostFormatted}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CostsTab({
  initialCosts,
  totalCost,
  userCostStartDate,
  userCostEndDate,
  usageLoading,
  usageError,
  openaiUsage,
  twilioLoading,
  twilioError,
  twilioUsage,
}: CostsTabProps) {
  return (
    <TabsContent value="costs">
      <Table>
        <TableCaption>
          Estimated OpenAI usage cost per user for {userCostStartDate} to{' '}
          {userCostEndDate}. The organization total below comes directly from
          OpenAI.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {initialCosts.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={3}
                className="text-center text-muted-foreground"
              >
                No cost data available
              </TableCell>
            </TableRow>
          ) : (
            initialCosts.map((cost, index) => (
              <TableRow key={cost.id}>
                <TableCell>{index + 1}</TableCell>
                <TableCell className="font-medium">{cost.email}</TableCell>
                <TableCell className="text-right">
                  ${costToNumber(cost.cost).toFixed(6)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Total Cost</TableCell>
            <TableCell className="text-right">${totalCost}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      {/* OpenAI API Usage (Last 30 Days) */}
      <OpenAIUsageDisplay {...{ usageLoading, usageError, openaiUsage }} />

      {/* Twilio Usage (Current & Last Month) */}
      <TwilioUsageDisplay {...{ twilioLoading, twilioError, twilioUsage }} />
    </TabsContent>
  )
}

interface ReportedIssuesTabProps {
  reportedIssues: ReportedIssue[]
  reportedIssuesLoading: boolean
  reportedIssuesError: string | null
  resolvingIssueId: string | null
  handleResolveIssue: (reportId: string) => void
}

function issueSeverityVariant(
  severity: StoredIssueDiagnosis['severity'],
): 'destructive' | 'secondary' | 'outline' {
  if (severity === 'critical' || severity === 'high') return 'destructive'
  return severity === 'medium' ? 'secondary' : 'outline'
}

function formatIssueDate(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function ReportedIssuesTab({
  reportedIssues,
  reportedIssuesLoading,
  reportedIssuesError,
  resolvingIssueId,
  handleResolveIssue,
}: ReportedIssuesTabProps) {
  const openIssueCount = reportedIssues.filter(
    (issue) => !issue.resolvedAt,
  ).length

  return (
    <TabsContent value="issues">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">
              Reported Issues (Last 30 Days)
            </h3>
            <p className="text-sm text-muted-foreground">
              {openIssueCount} open of {reportedIssues.length} total · newest
              100 retained
            </p>
          </div>
        </div>

        {reportedIssuesLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading reported issues...</span>
          </div>
        ) : reportedIssuesError ? (
          <p className="py-4 text-sm text-red-500">{reportedIssuesError}</p>
        ) : reportedIssues.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No issues reported in the last 30 days
          </p>
        ) : (
          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-2">
            {reportedIssues.map((issue) => (
              <article
                key={issue.reportId}
                className="space-y-4 rounded-lg border bg-muted p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={issueSeverityVariant(issue.diagnosis.severity)}
                      >
                        {issue.diagnosis.severity}
                      </Badge>
                      <Badge
                        variant={issue.resolvedAt ? 'secondary' : 'outline'}
                      >
                        {issue.resolvedAt ? 'Resolved' : 'Open'}
                      </Badge>
                      <Badge
                        variant={
                          issue.diagnosis.needsAmpEscalation
                            ? 'default'
                            : 'outline'
                        }
                      >
                        {issue.diagnosis.needsAmpEscalation
                          ? 'Amp review recommended'
                          : 'Explained by OpenAI'}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">
                        {issue.reportId}
                      </span>
                    </div>
                    <h4 className="font-semibold">{issue.title}</h4>
                    <p className="text-xs text-muted-foreground">
                      Reported by {issue.reporterEmail} · Occurred{' '}
                      {formatIssueDate(issue.occurredAt)}
                    </p>
                  </div>

                  {issue.resolvedAt ? (
                    <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      Resolved {formatIssueDate(issue.resolvedAt)}
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleResolveIssue(issue.reportId)}
                      disabled={resolvingIssueId !== null}
                    >
                      {resolvingIssueId === issue.reportId ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 aria-hidden="true" />
                      )}
                      {resolvingIssueId === issue.reportId
                        ? 'Resolving...'
                        : 'Resolve'}
                    </Button>
                  )}
                </div>

                <p className="whitespace-pre-wrap text-sm leading-6">
                  {issue.description}
                </p>

                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-start gap-2">
                    <CircleAlert
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Reason
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {issue.diagnosis.summary}
                      </p>
                    </div>
                  </div>
                  {issue.diagnosis.needsAmpEscalation && (
                    <div className="flex items-start gap-2">
                      <MessageSquareText
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Why deeper review was recommended
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {issue.diagnosis.escalationReason ??
                            'OpenAI triage was unavailable.'}
                        </p>
                      </div>
                    </div>
                  )}
                  {issue.unavailableSources.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Diagnostic sources unavailable:{' '}
                      {issue.unavailableSources.join(', ')}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </TabsContent>
  )
}

interface LeadsTabProps {
  showLeadsTab: boolean
  handleSyncLeads: () => void
  syncingLeads: boolean
  syncProgress: SyncProgress | null
  leadStats: LeadStats | null
}

function LeadsTab({
  showLeadsTab,
  handleSyncLeads,
  syncingLeads,
  syncProgress,
  leadStats,
}: LeadsTabProps) {
  return (
    <>
      {/* Nutshell CRM Leads Tab - tech@ only */}
      {showLeadsTab && (
        <TabsContent value="leads">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Nutshell CRM Leads</h3>
              <Button
                size="sm"
                onClick={handleSyncLeads}
                disabled={syncingLeads}
              >
                {syncingLeads ? (
                  <>
                    <Loader2
                      data-icon="inline-start"
                      className="mr-2 h-4 w-4 animate-spin"
                    />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw
                      data-icon="inline-start"
                      className="mr-2 h-4 w-4"
                    />
                    Sync from Nutshell
                  </>
                )}
              </Button>
            </div>

            {/* Sync progress bar */}
            {syncingLeads && syncProgress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {syncProgress.message ||
                      `Syncing ${syncProgress.synced} / ${syncProgress.total} leads...`}
                  </span>
                  {syncProgress.total > 0 && (
                    <span>
                      {Math.round(
                        ((syncProgress.synced + syncProgress.errors) /
                          syncProgress.total) *
                          100,
                      )}
                      %
                    </span>
                  )}
                </div>
                {syncProgress.total > 0 && (
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{
                        width: `${((syncProgress.synced + syncProgress.errors) / syncProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                )}
                {syncProgress.errors > 0 && (
                  <p className="text-xs text-red-500">
                    {syncProgress.errors} error
                    {syncProgress.errors !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            )}

            {/* Stats cards */}
            {leadStats && (
              <div className="grid grid-cols-4 gap-3">
                <div className="p-3 bg-muted rounded-lg border text-center">
                  <p className="text-2xl font-bold">{leadStats.totalLeads}</p>
                  <p className="text-xs text-muted-foreground">Total Leads</p>
                </div>
                <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-center">
                  <p className="text-2xl font-bold text-green-700">
                    {leadStats.wonCount}
                  </p>
                  <p className="text-xs text-green-600">Won</p>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-center">
                  <p className="text-2xl font-bold text-blue-700">
                    {leadStats.openCount}
                  </p>
                  <p className="text-xs text-blue-600">Open</p>
                </div>
                <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-center">
                  <p className="text-2xl font-bold text-red-700">
                    {leadStats.lostCount}
                  </p>
                  <p className="text-xs text-red-600">Lost</p>
                </div>
              </div>
            )}

            {/* Won revenue */}
            {leadStats && leadStats.wonCount > 0 && (
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-5 w-5 text-green-600" />
                  <h4 className="font-semibold text-green-800">
                    Total Won Revenue
                  </h4>
                </div>
                <p className="text-3xl font-bold text-green-700">
                  $
                  {leadStats.totalWonValue.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            )}
          </div>
        </TabsContent>
      )}
    </>
  )
}

function useRemoteAdminData() {
  const [openaiUsage, setOpenaiUsage] = useState<OpenAIUsage | null>(null)
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [twilioUsage, setTwilioUsage] = useState<TwilioUsage | null>(null)
  const [twilioLoading, setTwilioLoading] = useState(true)
  const [twilioError, setTwilioError] = useState<string | null>(null)
  const [reportedIssues, setReportedIssues] = useState<ReportedIssue[]>([])
  const [reportedIssuesLoading, setReportedIssuesLoading] = useState(true)
  const [reportedIssuesError, setReportedIssuesError] = useState<string | null>(
    null,
  )
  const [resolvingIssueId, setResolvingIssueId] = useState<string | null>(null)
  const [workerAvailability, setWorkerAvailability] =
    useState<WorkerAvailability>({})
  const [availabilityLoading, setAvailabilityLoading] = useState(true)

  useEffect(() => {
    async function fetchOpenAIUsage() {
      try {
        const response = await fetch('/api/openai/usage')
        if (!response.ok) {
          const errorBody = (await response.json().catch(() => null)) as {
            error?: string
            details?: string
          } | null
          throw new Error(
            errorBody?.details ||
              errorBody?.error ||
              'Failed to fetch usage data',
          )
        }
        const data = await response.json()
        setOpenaiUsage(data)
      } catch (error) {
        const message = getErrorMessage(error)
        console.error('Error fetching OpenAI usage:', message)
        setUsageError(message)
      } finally {
        setUsageLoading(false)
      }
    }

    async function fetchTwilioUsage() {
      try {
        const response = await fetch('/api/twilio/usage')
        if (!response.ok) throw new Error('Failed to fetch Twilio usage data')
        const data = await response.json()
        setTwilioUsage(data)
      } catch (error) {
        const message = getErrorMessage(error)
        console.error('Error fetching Twilio usage:', message)
        setTwilioError(message)
      } finally {
        setTwilioLoading(false)
      }
    }

    async function fetchReportedIssues() {
      try {
        const response = await fetch('/api/issues')
        const data = await handleApiResponse<{ issues: ReportedIssue[] }>(
          response,
        )
        setReportedIssues(data.issues)
      } catch (error) {
        const message = getErrorMessage(error)
        console.error('Error fetching reported issues:', message)
        setReportedIssuesError(message)
      } finally {
        setReportedIssuesLoading(false)
      }
    }

    async function fetchWorkerAvailability() {
      try {
        const response = await fetch('/api/taskrouter/worker-availability')
        if (!response.ok) throw new Error('Failed to fetch availability data')
        const data = await response.json()
        setWorkerAvailability(data.availability || {})
      } catch (error) {
        console.error('Error fetching worker availability:', error)
      } finally {
        setAvailabilityLoading(false)
      }
    }

    fetchOpenAIUsage()
    fetchTwilioUsage()
    fetchReportedIssues()
    fetchWorkerAvailability()
  }, [])

  async function handleResolveIssue(reportId: string) {
    setResolvingIssueId(reportId)
    try {
      const response = await fetch('/api/issues', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId }),
      })
      const data = await handleApiResponse<{ issue: ReportedIssue }>(response)
      setReportedIssues((issues) => {
        const updatedIssues = issues.map((issue) =>
          issue.reportId === data.issue.reportId ? data.issue : issue,
        )
        return [
          ...updatedIssues.filter((issue) => !issue.resolvedAt),
          ...updatedIssues.filter((issue) => issue.resolvedAt),
        ]
      })
      showSuccessToast(`${reportId} resolved`)
    } catch (error) {
      showErrorToast(error, 'The issue could not be resolved')
    } finally {
      setResolvingIssueId(null)
    }
  }

  return {
    openaiUsage,
    usageLoading,
    usageError,
    twilioUsage,
    twilioLoading,
    twilioError,
    reportedIssues,
    reportedIssuesLoading,
    reportedIssuesError,
    resolvingIssueId,
    handleResolveIssue,
    workerAvailability,
    availabilityLoading,
  }
}

function useUserController() {
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [isPending, setIsPending] = useState(false)
  const [phoneEdits, setPhoneEdits] = useState<Record<string, string>>({})
  const [signupOpen, setSignupOpen] = useState(false)
  const router = useRouter()

  const runUserAction = (
    action: Promise<{ success: boolean; message?: string }>,
    onSuccess?: () => void,
  ) => {
    setIsPending(true)
    void action
      .then((result) => {
        if (result.success) {
          onSuccess?.()
          router.refresh()
        } else {
          showErrorToast('Admin action failed')
        }
      })
      .catch((error) => showErrorToast(getErrorMessage(error)))
      .finally(() => setIsPending(false))
  }

  const toggleSelect = (id: string) => {
    setSelectedUsers((prev: string[]) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id],
    )
  }

  const handleDelete = () => {
    if (selectedUsers.length === 0) return
    runUserAction(deleteUsers(selectedUsers), () => {
      setSelectedUsers([])
      showSuccessToast('Users deleted successfully')
    })
  }

  const handleResetCounts = () => {
    if (
      !window.confirm(
        "Reset every user's call counts (Missed/Rejected/Accepted) and the Main-Number total to 0? This cannot be undone.",
      )
    ) {
      return
    }
    runUserAction(resetCallCounts(), () => {
      showSuccessToast('Call counts reset')
    })
  }

  const handleBackToDashboard = () => {
    router.push('/dashboard')
  }

  const handlePhoneUpdate = (userId: string, currentValue: string | null) => {
    const newValue = phoneEdits[userId]
    if (newValue === undefined || newValue === (currentValue ?? '')) return

    runUserAction(updateTwilioPhone(userId, newValue), () => {
      setPhoneEdits((prev) => {
        const next = { ...prev }
        delete next[userId]
        return next
      })
      showSuccessToast('Phone updated')
    })
  }

  const handleSignupSuccess = useCallback(() => {
    setSignupOpen(false)
    router.refresh()
  }, [router])

  return {
    selectedUsers,
    isPending,
    phoneEdits,
    setPhoneEdits,
    signupOpen,
    setSignupOpen,
    toggleSelect,
    handleDelete,
    handleResetCounts,
    handleBackToDashboard,
    handlePhoneUpdate,
    handleSignupSuccess,
  }
}

function useLeadSync(initialLeadStats: LeadStats | null) {
  const router = useRouter()
  const [leadStats, setLeadStats] = useState<LeadStats | null>(initialLeadStats)
  const [syncingLeads, setSyncingLeads] = useState(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)

  useEffect(() => {
    // Lead stats are refreshed by the server and intentionally mirrored locally
    // so an in-progress client sync can update the same value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeadStats(initialLeadStats)
  }, [initialLeadStats])

  const handleSyncLeads = async () => {
    setSyncingLeads(true)
    setSyncProgress(null)
    try {
      const response = await fetch('/api/nutshell/sync-leads', {
        method: 'POST',
      })

      if (!response.ok) throw new Error('Sync failed')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const data = getSseEvent(line)
          if (data)
            processSyncEvent(data, setSyncProgress, () => router.refresh())
        }
      }
    } catch (error) {
      showErrorToast(getErrorMessage(error))
    } finally {
      setSyncingLeads(false)
      setSyncProgress(null)
    }
  }

  return {
    leadStats,
    syncingLeads,
    syncProgress,
    handleSyncLeads,
  }
}

function getTotalCost(initialCosts: UserCost[]) {
  const total = Array.isArray(initialCosts)
    ? initialCosts.reduce((sum, user) => sum + costToNumber(user.cost), 0)
    : 0
  return total.toFixed(6)
}

export default function AdminClient({
  initialUsers = [],
  initialCosts = [],
  initialLeadStats = null,
  mainCallsTotal = 0,
  sessionEmail = '',
  sessionIssuedAt,
  userCostStartDate,
  userCostEndDate,
}: AdminClientProps) {
  useAutoLogout(sessionIssuedAt)

  const {
    selectedUsers,
    isPending,
    phoneEdits,
    setPhoneEdits,
    signupOpen,
    setSignupOpen,
    openaiUsage,
    usageLoading,
    usageError,
    twilioUsage,
    twilioLoading,
    twilioError,
    reportedIssues,
    reportedIssuesLoading,
    reportedIssuesError,
    resolvingIssueId,
    workerAvailability,
    availabilityLoading,
    leadStats,
    syncingLeads,
    syncProgress,
    toggleSelect,
    handleDelete,
    handleResetCounts,
    handleBackToDashboard,
    handlePhoneUpdate,
    handleResolveIssue,
    handleSyncLeads,
    handleSignupSuccess,
  } = {
    ...useRemoteAdminData(),
    ...useUserController(),
    ...useLeadSync(initialLeadStats),
  }
  const totalCost = getTotalCost(initialCosts)
  const showLeadsTab = sessionEmail === 'tech@billboardsource.com'

  return (
    <div className="flex flex-col min-h-svh w-full p-4 md:p-8 gap-5 bg-primary-foreground">
      <span role="status" aria-live="polite" className="sr-only">
        {isPending ? 'Saving admin changes' : ''}
      </span>
      <AdminHeader
        {...{
          signupOpen,
          setSignupOpen,
          handleSignupSuccess,
          handleBackToDashboard,
          selectedUsers,
          isPending,
          handleDelete,
        }}
      />
      <Tabs defaultValue="users" className="min-w-0 w-full">
        <TabsList
          className={`grid h-auto w-full min-w-0 grid-cols-2 mb-6 ${showLeadsTab ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}
        >
          <TabsTrigger value="users">User Accounts</TabsTrigger>
          <TabsTrigger value="costs">User Costs</TabsTrigger>
          <TabsTrigger value="issues">Reported Issues</TabsTrigger>
          {showLeadsTab && <TabsTrigger value="leads">CRM Leads</TabsTrigger>}
        </TabsList>

        <UsersTab
          {...{
            initialUsers,
            selectedUsers,
            isPending,
            toggleSelect,
            phoneEdits,
            setPhoneEdits,
            handlePhoneUpdate,
            handleResetCounts,
            mainCallsTotal,
            availabilityLoading,
            workerAvailability,
          }}
        />

        <CostsTab
          {...{
            initialCosts,
            totalCost,
            userCostStartDate,
            userCostEndDate,
            usageLoading,
            usageError,
            openaiUsage,
            twilioLoading,
            twilioError,
            twilioUsage,
          }}
        />

        <ReportedIssuesTab
          {...{
            reportedIssues,
            reportedIssuesLoading,
            reportedIssuesError,
            resolvingIssueId,
            handleResolveIssue,
          }}
        />

        <LeadsTab
          {...{
            showLeadsTab,
            handleSyncLeads,
            syncingLeads,
            syncProgress,
            leadStats,
          }}
        />
      </Tabs>
    </div>
  )
}
