import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function check() {
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
  
  console.log('═══════════════════════════════════════════');
  console.log('📞 CALLS IN LAST 10 MINUTES');
  console.log(`Now: ${now.toISOString()}`);
  console.log('═══════════════════════════════════════════\n');

  const calls = await client.calls.list({ 
    startTimeAfter: fiveMinAgo,
    limit: 50 
  });

  if (calls.length === 0) {
    console.log('No calls in the last 10 minutes');
    return;
  }

  for (const call of calls) {
    const status = call.status;
    const isFailed = ['busy', 'failed', 'no-answer', 'canceled'].includes(status);
    const icon = isFailed ? '❌' : '✅';
    
    console.log(`${icon} ${call.startTime?.toLocaleTimeString()}`);
    console.log(`   ${call.from} → ${call.to}`);
    console.log(`   Status: ${status} | Duration: ${call.duration}s | Direction: ${call.direction}`);
    if (isFailed) {
      console.log(`   ⚠️ ISSUE DETECTED`);
    }
    console.log('');
  }

  // Summary
  const failed = calls.filter(c => ['busy', 'failed', 'no-answer'].includes(c.status));
  console.log(`Summary: ${calls.length} calls, ${failed.length} failed/busy`);
}

check().catch(console.error);
