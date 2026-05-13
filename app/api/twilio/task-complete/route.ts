import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { user } from '@/db/schema'
import { eq } from 'drizzle-orm'

// Twilio sends task events as URL-encoded form data
export async function POST(req: NextRequest) {
  try {
    const body = await req.formData()
    const eventType = body.get('EventType') as string
    const workerSid = body.get('WorkerSid') as string

    console.log('📞 TaskRouter event received:', eventType, 'WorkerSid:', workerSid)

    // Only handle task completion events
    if (eventType !== 'task.completed' && eventType !== 'task.wrapup') {
      return NextResponse.json({ received: true })
    }

    if (!workerSid) {
      console.error('❌ No WorkerSid in task.completed event')
      return NextResponse.json({ received: true })
    }

    // Update lastCallAt for the worker who just completed the call
    await db
      .update(user)
      .set({ lastCallAt: new Date() })
      .where(eq(user.taskRouterWorkerSid, workerSid))

    console.log('✅ Updated lastCallAt for worker:', workerSid)

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('❌ Task complete webhook error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}