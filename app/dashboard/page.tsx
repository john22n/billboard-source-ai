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
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="@container/main flex flex-1 flex-col overflow-hidden px-2 lg:px-4">
            <div className="w-full h-full">
              <SalesCallTranscriber />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}