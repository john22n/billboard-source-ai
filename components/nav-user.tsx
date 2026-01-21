"use client"

import {
  IconDotsVertical,
  IconLogout,
  IconKey,
} from "@tabler/icons-react"
import { ShieldUser } from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { signOut } from "@/actions/auth"
import { useTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { PasskeyManager } from "@/components/passkey-manager"

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
    role?: string
  }
}) {
  const { isMobile } = useSidebar()
  const [isPending, startTransition] = useTransition()
  const [passkeyDialogOpen, setPasskeyDialogOpen] = useState(false)
  const router = useRouter()

  const handleLogout = () => {
    startTransition(async () => {
      // Clean up Twilio device if it exists (from TwilioProvider)
      if (typeof window !== 'undefined') {
        const twilioDeviceRef = (window as any).twilioDevice;
        if (twilioDeviceRef?.current && twilioDeviceRef.current.state !== 'destroyed') {
          console.log('🧹 Cleaning up Twilio device on logout');
          twilioDeviceRef.current.destroy();
        }
      }
      await signOut()
    })
  }

  const isAdmin = user.role === 'admin'

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg grayscale">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">
                  {user.name?.charAt(0).toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {user.email}
                </span>
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-lg">
                    {user.name?.charAt(0).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {isAdmin && (
              <>
                <DropdownMenuItem onClick={() => router.push('/admin')}>
                  <ShieldUser />
                  Admin Dashboard
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}

            <DropdownMenuItem onClick={() => setPasskeyDialogOpen(true)}>
              <IconKey />
              Manage Passkeys
            </DropdownMenuItem>
            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={handleLogout} disabled={isPending}>
              <IconLogout />
              {isPending ? "Logging out..." : "Log out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Passkey Management Dialog */}
        <Dialog open={passkeyDialogOpen} onOpenChange={setPasskeyDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Security Settings</DialogTitle>
            </DialogHeader>
            <PasskeyManager />
          </DialogContent>
        </Dialog>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}