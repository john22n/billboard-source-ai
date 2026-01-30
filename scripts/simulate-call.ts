/**
 * Simulate what happens when calls come in
 * Shows which workers would be selected for tasks
 */
import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function simulate() {
  console.log('═══════════════════════════════════════════');
  console.log('🔍 SIMULATING CALL ROUTING');
  console.log('═══════════════════════════════════════════\n');

  // Get all workers
  const allWorkers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list();

  // Main queue eligible workers
  const mainQueueWorkers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list({ 
      targetWorkersExpression: 'available == true AND role != "voicemail"',
      available: 'true'  // Only truly available workers
    });

  console.log('📞 MAIN NUMBER CALL (+18338547126):');
  console.log('   Available workers for round-robin:');
  for (const w of mainQueueWorkers) {
    console.log(`      ✓ ${w.friendlyName}`);
  }
  if (mainQueueWorkers.length === 0) {
    console.log('      ⚠️ NO WORKERS AVAILABLE - would go to voicemail');
  }

  // Show what happens if matt@ is on a direct call
  console.log('\n📞 SCENARIO: matt@ receives direct call to +17123773679');
  console.log('   His activity would change to: Unavailable');
  
  // Filter out matt
  const withoutMatt = mainQueueWorkers.filter(w => 
    w.friendlyName !== 'matt@billboardsource.com'
  );
  
  console.log('\n   If main number call comes in simultaneously:');
  console.log('   Available workers would be:');
  for (const w of withoutMatt) {
    console.log(`      ✓ ${w.friendlyName}`);
  }

  // Check current activities
  console.log('\n═══════════════════════════════════════════');
  console.log('⚡ ACTIVITY SIDS');
  console.log('═══════════════════════════════════════════\n');

  const activities = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .activities.list();

  for (const a of activities) {
    console.log(`${a.friendlyName}: ${a.sid} (available: ${a.available})`);
  }

  // Check if any workers are currently reserved/busy
  console.log('\n═══════════════════════════════════════════');
  console.log('🔒 WORKERS CURRENTLY BUSY (Unavailable activity)');
  console.log('═══════════════════════════════════════════\n');

  const busyWorkers = allWorkers.filter(w => 
    w.activityName === 'Unavailable' || 
    (w.activityName !== 'Available' && w.activityName !== 'Offline')
  );

  if (busyWorkers.length === 0) {
    console.log('   No workers currently busy');
  } else {
    for (const w of busyWorkers) {
      console.log(`   🔴 ${w.friendlyName}: ${w.activityName}`);
    }
  }
}

simulate().catch(console.error);
