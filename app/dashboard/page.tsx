import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { SalesCallTranscriberWrapper } from "@/components/SalesCallTranscriberWrapper"
import { getCurrentUser } from '@/lib/dal'

export default async function Page() {
  const currentUser = await getCurrentUser()

  if (!currentUser) {
    redirect('/login')
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
      <SidebarInset className="flex flex-col h-dvh min-h-0 overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <SiteHeader />
        <div className="flex-1 min-h-0 overflow-hidden p-2 lg:p-4">
          <SalesCallTranscriberWrapper />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}