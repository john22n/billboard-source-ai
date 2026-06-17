/**
 * Update TaskRouter Workflow
 *
 * Updates the workflow configuration to match current routing logic.
 * Matches setup from setup-taskrouter.ts
 *
 * Run with: npx dotenv -e .env.prod -- tsx scripts/update-workflow.ts
 */
import twilio from 'twilio'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!
const WORKFLOW_SID = process.env.TASKROUTER_WORKFLOW_SID!
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || 'https://billboard-source.vercel.app'

const MAIN_ROUTING_NUMBER = '+18338547126'
const DIRECT_NUMBERS = [
  '+12625876034',
  '+14177390805',
  '+15157383613',
  '+12237582821',
  '+15642342093',
  '+15418335744',
  '+13163953070',
  '+19783916647',
  '+17654396669',
  '+17123773679',
]

const client = twilio(ACCOUNT_SID, AUTH_TOKEN)

async function updateWorkflow() {
  console.log('═══════════════════════════════════════════')
  console.log('🔄 UPDATING TASKROUTER WORKFLOW')
  console.log('═══════════════════════════════════════════')

  // Get current queue SIDs
  const queues = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .taskQueues.list()

  const mainQueue = queues.find((q) => q.friendlyName === 'Main Random Queue')
  const voicemailQueue = queues.find((q) => q.friendlyName === 'Voicemail')

  if (!mainQueue || !voicemailQueue) {
    throw new Error('Required queues not found (Main Random Queue, Voicemail)')
  }

  // Build direct queue mapping
  const directQueues: Record<string, string> = {}
  for (const num of DIRECT_NUMBERS) {
    const queue = queues.find((q) => q.friendlyName === `Direct ${num}`)
    if (queue) {
      directQueues[num] = queue.sid
    } else {
      console.warn(`⚠️ Direct queue not found for ${num}`)
    }
  }

  // Worker exclusion expression — skips Sales Reps already offered this call.
  // excluded_workers is appended on every offer by the assignment callback and
  // by simultaneous-dial-complete, guaranteeing two DISTINCT Sales Reps and
  // never re-ringing the same rep (Feature 3).
  const workerExclusionExpression = 'worker.sid NOT IN task.excluded_workers'

  // Direct (Sales Rep Number) fallback: a distinct rep that is NOT the owner.
  const directFallbackExpression =
    'worker.sid NOT IN task.excluded_workers AND worker.email != task.primary_owner'

  // Sales Rep Call Attempts ring for 15 seconds (was 20). After two failed
  // attempts the call reaches the terminal Voicemail target, whose assignment
  // now redirects to the external Overflow Number (Feature 3).
  const RING_TIMEOUT = 15
  // Terminal target timeout: long enough for the overflow worker to be assigned.
  const TERMINAL_TIMEOUT = 120

  const workflowConfig = {
    task_routing: {
      filters: [
        // Direct numbers — owner first, then ONE other distinct rep, then overflow.
        ...DIRECT_NUMBERS.filter((num) => directQueues[num]).map((num) => ({
          filter_friendly_name: `Direct ${num}`,
          expression: `callTo == "${num}"`,
          targets: [
            // 1st: the Sales Rep who owns this number.
            {
              queue: directQueues[num],
              expression: workerExclusionExpression,
              timeout: RING_TIMEOUT,
            },
            // 2nd: one other distinct rep (not the owner).
            {
              queue: mainQueue.sid,
              expression: directFallbackExpression,
              timeout: RING_TIMEOUT,
            },
            // Terminal: overflow (assignment redirects voicemail worker → /overflow).
            { queue: voicemailQueue.sid, timeout: TERMINAL_TIMEOUT },
          ],
        })),

        // Company Routing Number — two distinct Sales Reps, then overflow.
        {
          filter_friendly_name: 'Main Number',
          expression: `callTo == "${MAIN_ROUTING_NUMBER}"`,
          targets: [
            // 1st attempt — skip any rep already offered the call.
            {
              queue: mainQueue.sid,
              expression: workerExclusionExpression,
              timeout: RING_TIMEOUT,
            },
            // 2nd attempt — skip again, guaranteeing a distinct rep.
            {
              queue: mainQueue.sid,
              expression: workerExclusionExpression,
              timeout: RING_TIMEOUT,
            },
            // Terminal: overflow.
            { queue: voicemailQueue.sid, timeout: TERMINAL_TIMEOUT },
          ],
        },
      ],
      default_filter: { queue: voicemailQueue.sid },
    },
  }

  console.log('Updating workflow...')
  console.log('Filters:', workflowConfig.task_routing.filters.length)

  await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workflows(WORKFLOW_SID)
    .update({
      configuration: JSON.stringify(workflowConfig),
      assignmentCallbackUrl: `${APP_URL}/api/taskrouter/assignment`,
      fallbackAssignmentCallbackUrl: `${APP_URL}/api/taskrouter/assignment`,
      taskReservationTimeout: 120,
    })

  console.log('✅ Workflow updated successfully')
  console.log('═══════════════════════════════════════════')
}

updateWorkflow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err)
    process.exit(1)
  })
