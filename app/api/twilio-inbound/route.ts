// app/api/twilio-inbound/route.ts
// Handles incoming Twilio calls and enqueues them into TaskRouter
import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { incrementMainCallsTotal } from '@/lib/dal'
import {
  configErrorResponseBody,
  isMissingConfig,
  serverConfig,
} from '@/lib/config'

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone()
    const bodyText = await clonedReq.text()
    const formData = await req.formData()

    // Validate Twilio signature — skip on preview deployments
    const isProduction = serverConfig.runtime.isProductionDeployment
    const twilioAuthToken = serverConfig.twilio.authToken

    if (twilioAuthToken && isProduction) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || ''
      const url = new URL(req.url)
      const params: Record<string, string> = {}
      const searchParams = new URLSearchParams(bodyText)
      searchParams.forEach((value, key) => {
        params[key] = value
      })

      const isValid = twilio.validateRequest(
        twilioAuthToken,
        twilioSignature,
        url.toString(),
        params,
      )

      if (!isValid) {
        return new Response('Forbidden', { status: 403 })
      }
    }

    const CallSid = formData.get('CallSid')
    const From = formData.get('From')
    const To = formData.get('To') as string
    const workflowSid = serverConfig.taskRouter.requireWorkflowSid()
    const companyRoutingNumber =
      serverConfig.twilio.mainNumber ?? '+18338547126'

    let callType: 'main' | 'direct'
    let phoneNumber: string | null = null
    let primaryOwner: string | null = null

    // ─────────────────────────────────────────────
    // MAIN NUMBER → RANDOM AGENTS
    // ─────────────────────────────────────────────
    if (To === companyRoutingNumber) {
      callType = 'main'
      // Count every inbound call to the Main Routing Number (Admin Panel
      // header total). Production only; not gated by business hours.
      if (isProduction) {
        try {
          await incrementMainCallsTotal()
        } catch (err) {
          console.error('❌ incrementMainCallsTotal failed:', err)
        }
      }
    } else {
      // ─────────────────────────────────────────────
      // DIRECT NUMBER → SINGLE AGENT
      // ─────────────────────────────────────────────
      callType = 'direct'
      phoneNumber = To

      const matchedUser = await db
        .select()
        .from(user)
        .where(eq(user.twilioPhoneNumber, To))
        .limit(1)
        .then((rows) => rows[0])

      if (!matchedUser) {
        const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say>This number is not configured.</Say>
          <Hangup/>
        </Response>`
        return new Response(errorTwiml, {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        })
      }

      primaryOwner = matchedUser.email
    }

    const taskAttributes = JSON.stringify({
      call_sid: CallSid,
      from: From,
      callTo: To,
      callType,
      phoneNumber,
      primary_owner: primaryOwner,
      // Routing state (Feature 3): Sales Reps already offered this call, the
      // number of distinct attempts made, and whether a non-owner fallback rep
      // has been offered for a direct (Sales Rep Number) call.
      excluded_workers: [],
      attempt_count: 0,
      direct_fallback_offered: false,
    })

    const appUrl = serverConfig.app.baseUrlFromRequest(req.url)

    const waitUrlObj = new URL(`${appUrl}/api/taskrouter/wait`)
    serverConfig.app.addVercelBypassToken(waitUrlObj)

    const enqueueActionUrlObj = new URL(
      `${appUrl}/api/taskrouter/enqueue-complete`,
    )
    serverConfig.app.addVercelBypassToken(enqueueActionUrlObj)

    const escapedWaitUrl = waitUrlObj.toString().replace(/&/g, '&amp;')
    const escapedEnqueueActionUrl = enqueueActionUrlObj
      .toString()
      .replace(/&/g, '&amp;')

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Please hold while we connect you with the next available representative.</Say>
  <Enqueue workflowSid="${workflowSid}"
           action="${escapedEnqueueActionUrl}"
           method="POST"
           waitUrl="${escapedWaitUrl}"
           waitUrlMethod="POST">
    <Task>${taskAttributes}</Task>
  </Enqueue>
</Response>`

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (err) {
    if (isMissingConfig(err)) {
      return Response.json(configErrorResponseBody(err), { status: 500 })
    }
    console.error('Inbound error:', err)
    return new Response('Error', { status: 500 })
  }
}
