"use client"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { WorkerStatusToggle } from "@/components/WorkerStatusToggle"
import { BrainCircuit } from "lucide-react"

export function SiteHeader() {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-2 sm:px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-1 sm:mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">
          <BrainCircuit className="size-4" />
        </h1>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <span className="hidden sm:inline text-sm text-muted-foreground">Available to take calls?</span>
          <WorkerStatusToggle />
        </div>
      </div>
    </header>
  )
}