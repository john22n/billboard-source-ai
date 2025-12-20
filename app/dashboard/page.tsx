import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import SalesCallTranscriber from "@/components/SalesCallTranscriber"
import { getCurrentUser } from '@/lib/dal'

export default async function Page() {
  const currentUser = await getCurrentUser()
  
  if (!currentUser) {
    redirect('/')
  }

  return (
    <SidebarProvider
      defaultOpen={false}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar
        variant="inset"
        user={{
          name: currentUser.email.split('@')[0],
          email: currentUser.email,
          avatar: "",
          role: currentUser.role ?? undefined
        }}
      />
      <SidebarInset className="flex flex-col h-screen overflow-hidden">
        <SiteHeader />
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden px-2 lg:px-4">
            <SalesCallTranscriber />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}