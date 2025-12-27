import { redirect } from "next/navigation"
import { Suspense } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import SalesCallTranscriber from "@/components/SalesCallTranscriber"
import { getCurrentUser } from '@/lib/dal'

function DashboardSkeleton() {
  return (
    <div className="h-full bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-1 animate-pulse">
      <div className="h-full max-w-[1800px] mx-auto flex flex-col">
        <div className="bg-white rounded-lg shadow-2xl h-full flex flex-col">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 h-20 rounded-t-lg" />
          <div className="flex-1 p-4 space-y-4">
            <div className="h-10 bg-slate-200 rounded w-full" />
            <div className="flex gap-4 flex-1">
              <div className="flex-[2] bg-slate-100 rounded-lg" />
              <div className="w-96 bg-slate-100 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

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
            <Suspense fallback={<DashboardSkeleton />}>
              <SalesCallTranscriber />
            </Suspense>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}