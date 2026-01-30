import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function check() {
  console.log('═══════════════════════════════════════════');
  console.log('📞 RECENT CALL LOGS (last 20)');
  console.log('═══════════════════════════════════════════\n');

  const calls = await client.calls.list({ limit: 20 });

  for (const call of calls) {
    const status = call.status;
    const isFailed = ['busy', 'failed', 'no-answer', 'canceled'].includes(status);
    const icon = isFailed ? '❌' : '✅';
    
    console.log(`${icon} ${call.sid.slice(-8)}`);
    console.log(`   From: ${call.from} → To: ${call.to}`);
    console.log(`   Status: ${status}`);
    console.log(`   Direction: ${call.direction}`);
    console.log(`   Duration: ${call.duration}s`);
    console.log(`   Start: ${call.startTime}`);
    if (isFailed) {
      console.log(`   ⚠️ FAILED/BUSY - Check why!`);
    }
    console.log('');
  }

  // Look for patterns
  console.log('═══════════════════════════════════════════');
  console.log('📊 STATUS SUMMARY');
  console.log('═══════════════════════════════════════════\n');

  const statusCounts: Record<string, number> = {};
  for (const call of calls) {
    statusCounts[call.status] = (statusCounts[call.status] || 0) + 1;
  }

  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`   ${status}: ${count}`);
  }
}

check().catch(console.error);
