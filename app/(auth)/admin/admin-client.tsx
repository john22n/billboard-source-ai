'use client'

import { useState, useTransition, useEffect } from "react"
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
import { Trash2, Loader2 } from "lucide-react"
import { deleteUsers } from "@/actions/user-actions"
import { useRouter } from "next/navigation"
import type { User } from "@/db/schema"
import { BillboardDataUploader } from "@/components/BillboardDataUploader"

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

// Define a type for the cost parameter
type CostValue = string | number | { toNumber?: () => number; toFixed?: () => string } | null | undefined

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
  const router = useRouter()

  // OpenAI usage state
  const [openaiUsage, setOpenaiUsage] = useState<OpenAIUsage | null>(null)
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState<string | null>(null)

  // Twilio usage state
  const [twilioUsage, setTwilioUsage] = useState<TwilioUsage | null>(null)
  const [twilioLoading, setTwilioLoading] = useState(true)
  const [twilioError, setTwilioError] = useState<string | null>(null)

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
        console.error('Error fetching OpenAI usage:', error)
        setUsageError('Failed to load OpenAI usage data')
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
        console.error('Error fetching Twilio usage:', error)
        setTwilioError('Failed to load Twilio usage data')
      } finally {
        setTwilioLoading(false)
      }
    }

    fetchOpenAIUsage()
    fetchTwilioUsage()
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
        router.refresh() 
      } else {
        console.error("Failed to delete:", result.message)
      }
    })
  }

  const handleBackToDashboard = () => {
    router.push('/dashboard')
  }

  const totalCostNumber = Array.isArray(initialCosts) 
    ? initialCosts.reduce((sum, u) => sum + costToNumber(u.cost), 0)
    : 0
  const totalCost = totalCostNumber.toFixed(6)

  return (
    <div className="flex flex-col lg:flex-row min-h-svh">
      <div className="flex flex-col gap-4 p-6 md:p-10 w-full lg:w-1/2">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <SignupForm onSuccess={() => router.refresh()} />
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
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="users">User Accounts</TabsTrigger>
            <TabsTrigger value="costs">User Costs</TabsTrigger>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
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

          {/* NEW: Billboard Data Tab */}
          <TabsContent value="billboard" className="w-full">
            <BillboardDataUploader />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}