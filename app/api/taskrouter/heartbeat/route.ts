// app/api/taskrouter/heartbeat/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function POST() {
  try {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Heartbeat acknowledged - worker is still active
    // You could optionally update a "lastSeen" timestamp in your database here
    
    return NextResponse.json({ 
      status: "ok", 
      timestamp: Date.now() 
    });
  } catch (error) {
    console.error("Heartbeat error:", error);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}