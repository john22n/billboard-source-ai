import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import SalesCallTranscriber from "@/components/SalesCallTranscriber"
import { getCurrentUser } from '@/lib/dal'
import data from "./data.json"

export default async function Page() {
  // Get the current user
  const currentUser = await getCurrentUser()
  
  // Redirect to home if not logged in
  if (!currentUser) {
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
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <SalesCallTranscriber />
              {/*<SectionCards />
                <div className="px-4 lg:px-6">
                  <ChartAreaInteractive />
                </div>
                <DataTable data={data} />
              */}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}