"use client"
import { useRef, useState } from "react"
import { RealtimeAgent, RealtimeItem, RealtimeSession, tool } from "@openai/agents/realtime"
import { getSessionToken } from "@/lib/token"
import z from "zod"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

const agent = new RealtimeAgent({
  name: "Voice Agent",
  instructions: "You are a voice agent that can listen to a 2 ppl conversation and summarize the interaction between a sales associate of Billboard Source the billboard advertising brokerage and a potential client looking for a billboard to purchase",
  handoffs: [],
})

export function SiteHeader() {
  const session = useRef<RealtimeSession | null>(null)
  const [connected, setConnected] = useState(false)
  const [history, setHistory] = useState<RealtimeSession[]>([])

  async function onConnect() {
    if (connected) {
      setConnected(false)
      await session.current?.close()
    } else {
      const token = await getSessionToken()
      session.current = new RealtimeSession(agent, {
        model: 'gpt-4o-realtime-preview-2025-06-03'
      })
      session.current.on("transport_event", (event) => {
        console.log(event)
      })
      session.current.on("tool_approval_requested",
        async (context, agent, approvalRequest) => {
          const response = prompt("Approve or deny the tool call?")
          session.current?.approve(approvalRequest.approvalItem)
        }
      )
      await session.current.connect({
        apiKey: token
      })
      setConnected(true)
    }
  }

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)" >
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">Documents</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={onConnect}>
            {connected ? "Disconnect" : "Connect"}
          </Button>
        </div>
      </div>
    </header >
  )
}
