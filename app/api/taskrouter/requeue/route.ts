/**
 * Requeue TwiML Handler
 *
 * Returns <Enqueue> TwiML to put a caller back into the TaskRouter workflow.
 * Called via Twilio REST API call redirect (client.calls(sid).update({ url }))
 * from the AMD status callback when machine detection fires.
 *
 * Query parameters:
 *   workflowSid      — TaskRouter Workflow SID
 *   taskAttributes   — JSON string of original task attributes (with retried:true)
 *   waitUrl          — URL for hold music while waiting
 *   enqueueActionUrl — URL called when call leaves the queue
 */

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);

    const workflowSid      = url.searchParams.get('workflowSid')      ?? process.env.TASKROUTER_WORKFLOW_SID ?? '';
    const taskAttributes   = url.searchParams.get('taskAttributes')   ?? '{}';
    const waitUrl          = url.searchParams.get('waitUrl')          ?? '';
    const enqueueActionUrl = url.searchParams.get('enqueueActionUrl') ?? '';

    console.log('═══════════════════════════════════════════');
    console.log('🔄 REQUEUE HANDLER');
    console.log('WorkflowSid:', workflowSid);
    console.log('═══════════════════════════════════════════');

    if (!workflowSid) {
      console.error('❌ Missing workflowSid');
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    const escapedWaitUrl          = waitUrl.replace(/&/g, '&amp;');
    const escapedEnqueueActionUrl = enqueueActionUrl.replace(/&/g, '&amp;');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Enqueue workflowSid="${workflowSid}"
           action="${escapedEnqueueActionUrl}"
           method="POST"
           waitUrl="${escapedWaitUrl}"
           waitUrlMethod="POST">
    <Task>${taskAttributes}</Task>
  </Enqueue>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('❌ Requeue handler error:', error);
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}