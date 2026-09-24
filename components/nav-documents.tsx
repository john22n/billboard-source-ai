'use client'

import { FileText, Mic } from 'lucide-react'
import { useDashboardStore } from '@/stores/dashboardStore'
import {
  IconDots,
  IconFolder,
  IconShare3,
  IconTrash,
  type Icon,
} from '@tabler/icons-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

export function NavDocuments({
  items,
}: {
  items: {
    name: string
    url: string
    icon: Icon
  }[]
}) {
  const { isMobile, setOpen, setOpenMobile } = useSidebar()
  const activeTab = useDashboardStore((state) => state.activeTab)
  const setActiveTab = useDashboardStore((state) => state.setActiveTab)
  const transcriptStartedAt = useDashboardStore(
    (state) => state.transcriptStartedAt,
  )
  const transcriptDate =
    transcriptStartedAt === null ? null : new Date(transcriptStartedAt)

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>History</SidebarGroupLabel>
      <SidebarMenu>
        {transcriptDate && (
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              className="min-w-0 flex-1"
              tooltip="Transcript"
              isActive={activeTab === 'transcript'}
              aria-controls="dashboard-transcript"
              onClick={() => {
                setActiveTab('transcript')
                setOpen(false)
                setOpenMobile(false)
              }}
            >
              <FileText />
              <span>Transcript</span>
            </SidebarMenuButton>
            <time
              dateTime={transcriptDate.toISOString()}
              className="shrink-0 pr-2 text-right text-xs leading-tight text-muted-foreground"
              title={transcriptDate.toLocaleString()}
            >
              <span className="block">
                {transcriptDate.toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              <span className="block">
                {transcriptDate.toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </time>
          </SidebarMenuItem>
        )}
        {!transcriptDate && items.length === 0 && (
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <Mic className="h-4 w-4" />
              <span>No transcript yet</span>
            </div>
          </SidebarMenuItem>
        )}
        {items.length > 0 && (
          <>
            {items.map((item) => (
              <SidebarMenuItem key={item.name}>
                <SidebarMenuButton asChild>
                  <a href={item.url}>
                    <item.icon />
                    <span>{item.name}</span>
                  </a>
                </SidebarMenuButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuAction
                      showOnHover
                      className="data-[state=open]:bg-accent rounded-sm"
                    >
                      <IconDots />
                      <span className="sr-only">More</span>
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="w-24 rounded-lg"
                    side={isMobile ? 'bottom' : 'right'}
                    align={isMobile ? 'end' : 'start'}
                  >
                    <DropdownMenuItem>
                      <IconFolder />
                      <span>Open</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <IconShare3 />
                      <span>Share</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive">
                      <IconTrash />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            ))}
            <SidebarMenuItem>
              <SidebarMenuButton className="text-sidebar-foreground/70">
                <IconDots className="text-sidebar-foreground/70" />
                <span>More</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </>
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
