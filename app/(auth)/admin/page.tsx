'use client'

import { useState, useEffect } from "react"
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
import { Trash2 } from "lucide-react"

// ✅ Helper function to safely convert any value to a number
function costToNumber(cost: any): number {
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

export default function AdminPage() {
  const [users, setUsers] = useState<any[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [userCosts, setUserCosts] = useState<any[]>([])
  const [loadingCosts, setLoadingCosts] = useState(true)

  // Fetch users
  const fetchUsers = async () => {
    setLoadingUsers(true)
    try {
      const res = await fetch("/api/users")
      const data = await res.json()
      if (Array.isArray(data)) setUsers(data)
      else if (Array.isArray(data.users)) setUsers(data.users)
      else setUsers([])
    } catch (err) {
      console.error("Failed to fetch users:", err)
      setUsers([])
    } finally {
      setLoadingUsers(false)
    }
  }

  // Fetch user costs
  const fetchUserCosts = async () => {
    setLoadingCosts(true)
    try {
      const res = await fetch("/api/users/costs")
      const data = await res.json()
      if (Array.isArray(data)) setUserCosts(data)
      else if (Array.isArray(data.costs)) setUserCosts(data.costs)
      else setUserCosts([])
    } catch (err) {
      console.error("Failed to fetch user costs:", err)
      setUserCosts([])
    } finally {
      setLoadingCosts(false)
    }
  }

  // On mount
  useEffect(() => {
    fetchUsers()
    fetchUserCosts()
  }, [])

  // Toggle checkbox selection
  const toggleSelect = (id: string) => {
    setSelectedUsers(prev =>
      prev.includes(id) ? prev.filter(u => u !== id) : [...prev, id]
    )
  }

  // Delete users
  // Delete users
const handleDelete = async () => {
  if (selectedUsers.length === 0) return

  try {
    const res = await fetch("/api/users/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedUsers }),
    })

    const data = await res.json()

    if (res.ok && data.success) {
      // Remove deleted users from both tables
      setUsers(prev => prev.filter(u => !selectedUsers.includes(u.id)))
      setUserCosts(prev => prev.filter(c => !selectedUsers.includes(c.id)))

      setSelectedUsers([])
      console.log("Users deleted successfully")
    } else {
      console.error("Failed to delete:", data.message)
    }
  } catch (err) {
    console.error("Failed to delete users:", err)
  }
}


  // Refresh users when new one is created
 // Refresh users and costs when a new one is created
const handleUserCreated = async () => {
  await Promise.all([fetchUsers(), fetchUserCosts()])
}


  // ✅ Fix total cost calculation (convert each to number)
  const totalCostNumber = userCosts.reduce(
    (sum, u) => sum + costToNumber(u.cost),
    0
  )
  const totalCost = totalCostNumber.toFixed(6)

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Left side: Signup */}
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <SignupForm onSuccess={handleUserCreated} />
          </div>
        </div>
      </div>

      {/* Right side: User tables */}
      <div className="relative hidden lg:flex flex-col justify-center items-center p-10 w-full gap-5 lg:bg-primary-foreground">
        {/* Header Row */}
        <div className="w-full flex items-center justify-center mb-4 relative">
          <h2 className="text-2xl font-semibold text-center w-full">
            User Management
          </h2>

          <Button
            variant="destructive"
            size="sm"
            disabled={selectedUsers.length === 0}
            onClick={handleDelete}
            className="absolute right-0"
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete Selected
          </Button>
        </div>

        <Tabs defaultValue="users" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="users">User Accounts</TabsTrigger>
            <TabsTrigger value="costs">User Costs</TabsTrigger>
          </TabsList>

          {/* ---- USERS TAB ---- */}
          <TabsContent value="users">
            {loadingUsers ? (
              <p>Loading users...</p>
            ) : (
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
                  {users.map((user, index) => (
                    <TableRow key={user.id}>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={selectedUsers.includes(user.id)}
                          onCheckedChange={() => toggleSelect(user.id)}
                        />
                      </TableCell>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.role ?? "User"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* ---- COSTS TAB ---- */}
          <TabsContent value="costs">
            {loadingCosts ? (
              <p>Loading costs...</p>
            ) : (
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
                  {userCosts.map((cost, index) => (
                    <TableRow key={cost.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="font-medium">{cost.email}</TableCell>
                      <TableCell className="text-right">
                        ${costToNumber(cost.cost).toFixed(6)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2}>Total Cost</TableCell>
                    <TableCell className="text-right">${totalCost}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}



