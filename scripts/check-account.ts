import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function check() {
  console.log('═══════════════════════════════════════════');
  console.log('📊 TWILIO ACCOUNT STATUS');
  console.log('═══════════════════════════════════════════\n');

  const account = await client.api.accounts(ACCOUNT_SID).fetch();
  console.log('Account SID:', account.sid);
  console.log('Friendly Name:', account.friendlyName);
  console.log('Status:', account.status);
  console.log('Type:', account.type);
  console.log('Created:', account.dateCreated);
  
  // Check usage to see concurrent calls
  console.log('\n═══════════════════════════════════════════');
  console.log('📞 CURRENT IN-PROGRESS CALLS');
  console.log('═══════════════════════════════════════════\n');

  const inProgressCalls = await client.calls.list({ status: 'in-progress' });
  console.log(`In-progress calls: ${inProgressCalls.length}`);

  const ringingCalls = await client.calls.list({ status: 'ringing' });
  console.log(`Ringing calls: ${ringingCalls.length}`);

  const queuedCalls = await client.calls.list({ status: 'queued' });
  console.log(`Queued calls: ${queuedCalls.length}`);

  console.log('\nTotal concurrent: ', inProgressCalls.length + ringingCalls.length + queuedCalls.length);
  console.log('\n⚠️ If you are hitting concurrency limits, contact Twilio Support');
  console.log('   to request a limit increase or complete your Customer Profile');
}

check().catch(console.error);
