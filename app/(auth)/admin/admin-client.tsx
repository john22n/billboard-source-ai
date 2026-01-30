'use client'

import { useState, useTransition, useEffect, useCallback } from "react"
import { SignupForm } from "@/components/sign-up"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Trash2, Loader2, FileText } from "lucide-react"
import { deleteUsers, updateTwilioPhone } from "@/actions/user-actions"
import { useRouter } from "next/navigation"
import type { User } from "@/db/schema"
import { BillboardDataUploader } from "@/components/BillboardDataUploader"
import { showErrorToast, showSuccessToast, getErrorMessage } from "@/lib/error-handling"

interface OpenAIUsage {
  totalCost: number;
  totalCostFormatted: string;
  startDate: string;
  endDate: string;
}

interface TwilioUsage {
  currentMonth: {
    name: string;
    cost: number;
    costFormatted: string;
  };
  lastMonth: {
    name: string;
    cost: number;
    costFormatted: string;
  };
  totalCost: number;
  totalCostFormatted: string;
}

interface Voicemail {
  sid: string;
  callSid: string;
  from: string;
  dateCreated: string;
  duration: number;
  recordingUrl: string;
  transcription: string | null;
  transcriptionStatus: string | null;
}

// Define a type for the cost parameter
type CostValue = string | number | { toNumber?: () => number; toFixed?: () => string } | null | undefined

function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`
  }
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
  }
  return phone
}

function costToNumber(cost: CostValue): number {
  if (cost == null) return 0
  if (typeof cost === "number") return cost
  if (typeof cost === "string") {
    const n = Number(cost)
    return Number.isFinite(n) ? n : 0
  }
  if (typeof cost === "object") {
    if (typeof cost.toNumber === "function") return cost.toNumber()
    if (typeof cost.toFixed === "function") {
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

interface AdminClientProps {
  initialUsers: User[]
  initialCosts: UserCost[]
}

export default function AdminClient({
  initialUsers = [],
  initialCosts = []
}: AdminClientProps) {
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()
  const [phoneEdits, setPhoneEdits] = useState<Record<string, string>>({})
  const router = useRouter()

  // OpenAI usage state
  const [openaiUsage, setOpenaiUsage] = useState<OpenAIUsage | null>(null)
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState<string | null>(null)

  // Twilio usage state
  const [twilioUsage, setTwilioUsage] = useState<TwilioUsage | null>(null)
  const [twilioLoading, setTwilioLoading] = useState(true)
  const [twilioError, setTwilioError] = useState<string | null>(null)

  // Voicemails state
  const [voicemails, setVoicemails] = useState<Voicemail[]>([])
  const [voicemailsLoading, setVoicemailsLoading] = useState(true)
  const [voicemailsError, setVoicemailsError] = useState<string | null>(null)

  // Fetch OpenAI and Twilio usage on mount
  useEffect(() => {
    async function fetchOpenAIUsage() {
      try {
        const response = await fetch('/api/openai/usage')
        if (!response.ok) {
          throw new Error('Failed to fetch usage data')
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
        if (!response.ok) {
          throw new Error('Failed to fetch Twilio usage data')
        }
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

    async function fetchVoicemails() {
      try {
        const response = await fetch('/api/twilio/voicemails')
        if (!response.ok) {
          throw new Error('Failed to fetch voicemails')
        }
        const data = await response.json()
        setVoicemails(data.voicemails || [])
      } catch (error) {
        const message = getErrorMessage(error)
        console.error('Error fetching voicemails:', message)
        setVoicemailsError(message)
      } finally {
        setVoicemailsLoading(false)
      }
    }

    fetchOpenAIUsage()
    fetchTwilioUsage()
    fetchVoicemails()
  }, [])

  const toggleSelect = (id: string) => {
    setSelectedUsers((prev: string[]) =>
      prev.includes(id) ? prev.filter(u => u !== id) : [...prev, id]
    )
  }

  const handleDelete = async () => {
    if (selectedUsers.length === 0) return
    startTransition(async () => {
      const result = await deleteUsers(selectedUsers)
      if (result.success) {
        setSelectedUsers([])
        showSuccessToast('Users deleted successfully')
        router.refresh() 
      } else {
        showErrorToast(result.message || 'Failed to delete users')
      }
    })
  }

  const handleBackToDashboard = () => {
    router.push('/dashboard')
  }

  const handlePhoneUpdate = async (userId: string, currentValue: string | null) => {
    const newValue = phoneEdits[userId]
    if (newValue === undefined || newValue === (currentValue ?? '')) return

    startTransition(async () => {
      const result = await updateTwilioPhone(userId, newValue)
      if (result.success) {
        showSuccessToast(result.message || 'Phone updated')
        setPhoneEdits(prev => {
          const next = { ...prev }
          delete next[userId]
          return next
        })
        router.refresh()
      } else {
        showErrorToast(result.message || 'Failed to update')
      }
    })
  }

  const totalCostNumber = Array.isArray(initialCosts)
    ? initialCosts.reduce((sum, u) => sum + costToNumber(u.cost), 0)
    : 0
  const totalCost = totalCostNumber.toFixed(6)

  const handleSignupSuccess = useCallback(() => {
    router.refresh()
  }, [router])

  return (
    <div className="flex flex-col lg:flex-row min-h-svh">
      <div className="flex flex-col gap-4 p-6 md:p-10 w-full lg:w-1/2">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <SignupForm onSuccess={handleSignupSuccess} />
          </div>
        </div>
      </div>
      <div className="flex flex-col justify-center items-center p-6 md:p-10 w-full lg:w-1/2 gap-5 bg-primary-foreground">
        <div className="w-full flex items-center justify-between mb-4">
          <Button 
            size="sm" 
            onClick={handleBackToDashboard}
          >
            back to Dashboard
          </Button>
          <h2 className="text-2xl font-semibold">
            Admin Panel
          </h2>
          <Button
            variant="destructive"
            size="sm"
            disabled={selectedUsers.length === 0 || isPending}
            onClick={handleDelete}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {isPending ? "Deleting..." : "Delete Selected"}
          </Button>
        </div>
        <Tabs defaultValue="users" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="users">User Accounts</TabsTrigger>
            <TabsTrigger value="costs">User Costs</TabsTrigger>
            <TabsTrigger value="voicemails">Voicemails</TabsTrigger>
            <TabsTrigger value="billboard">Billboard Data</TabsTrigger>
          </TabsList>
          
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  initialUsers.map((user, index) => (
                    <TableRow key={user.id}>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={selectedUsers.includes(user.id)}
                          onCheckedChange={() => toggleSelect(user.id)}
                          disabled={isPending}
                        />
                      </TableCell>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.role ?? "User"}</TableCell>
                      <TableCell>
                        <Input
                          type="tel"
                          className="h-8 w-32"
                          placeholder="+1234567890"
                          value={phoneEdits[user.id] ?? user.twilioPhoneNumber ?? ''}
                          onChange={(e) => setPhoneEdits(prev => ({ ...prev, [user.id]: e.target.value }))}
                          onBlur={() => handlePhoneUpdate(user.id, user.twilioPhoneNumber)}
                          onKeyDown={(e) => e.key === 'Enter' && handlePhoneUpdate(user.id, user.twilioPhoneNumber)}
                          disabled={isPending}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TabsContent>
          
          <TabsContent value="costs">
            <Table>
              <TableCaption>OpenAI usage cost per user.</TableCaption>
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
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
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
            <div className="mt-6 p-4 bg-muted rounded-lg border">
              <h3 className="text-sm font-semibold mb-2">OpenAI API Usage (Last 30 Days)</h3>
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
                    <span className="text-sm text-muted-foreground">Total API Cost</span>
                    <span className="text-xl font-bold">{openaiUsage.totalCostFormatted}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {openaiUsage.startDate} to {openaiUsage.endDate}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Twilio Usage (Current & Last Month) */}
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
                    <span className="text-sm text-muted-foreground">{twilioUsage.currentMonth.name} (Current)</span>
                    <span className="text-lg font-semibold">{twilioUsage.currentMonth.costFormatted}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">{twilioUsage.lastMonth.name} (Last)</span>
                    <span className="text-lg font-semibold">{twilioUsage.lastMonth.costFormatted}</span>
                  </div>
                  <div className="pt-2 border-t flex justify-between items-center">
                    <span className="text-sm font-medium">Total</span>
                    <span className="text-xl font-bold">{twilioUsage.totalCostFormatted}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </TabsContent>

          {/* Voicemails Tab */}
          <TabsContent value="voicemails">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Voicemails (Last 7 Days)</h3>
                <span className="text-sm text-muted-foreground">
                  {voicemails.length} recording{voicemails.length !== 1 ? 's' : ''}
                </span>
              </div>
              
              {voicemailsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading voicemails...</span>
                </div>
              ) : voicemailsError ? (
                <p className="text-sm text-red-500 py-4">{voicemailsError}</p>
              ) : voicemails.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No voicemails in the last 7 days
                </p>
              ) : (
                <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                  {voicemails.map((vm) => (
                    <div
                      key={vm.sid}
                      className="p-4 bg-muted rounded-lg border space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="font-medium">{formatPhoneNumber(vm.from)}</span>
                          <span className="text-sm text-muted-foreground">
                            {vm.duration}s
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(vm.dateCreated).toLocaleDateString()}{' '}
                          {new Date(vm.dateCreated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      
                      {vm.transcription ? (
                        <div className="flex items-start gap-2 pt-2 border-t">
                          <FileText className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <p className="text-sm">{vm.transcription}</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 pt-2 border-t text-muted-foreground">
                          <FileText className="h-4 w-4" />
                          <span className="text-sm italic">
                            {vm.transcriptionStatus === 'in-progress' 
                              ? 'Transcription in progress...' 
                              : 'No transcription available'}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Billboard Data Tab */}
          <TabsContent value="billboard" className="w-full">
            <BillboardDataUploader />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}