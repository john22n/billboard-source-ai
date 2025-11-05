import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import SalesCallTranscriber from "@/components/SalesCallTranscriber"
import { getSession } from '@/lib/auth'


export default async function Page() {
  const session = await getSession()
  console.log(session)

  if (!session) {
    redirect('/')
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="@container/main flex flex-1 flex-col overflow-hidden">
            <SalesCallTranscriber />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
