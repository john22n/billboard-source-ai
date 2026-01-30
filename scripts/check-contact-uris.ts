import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function check() {
  console.log('═══════════════════════════════════════════');
  console.log('🔍 CHECKING WORKER CONTACT URIs');
  console.log('═══════════════════════════════════════════\n');

  const workers = await client.taskrouter.v1
    .workspaces(WORKSPACE_SID)
    .workers.list();

  const contactUris = new Map<string, string[]>();

  for (const w of workers) {
    const attrs = JSON.parse(w.attributes);
    const uri = attrs.contact_uri || 'NO_URI';
    
    if (!contactUris.has(uri)) {
      contactUris.set(uri, []);
    }
    contactUris.get(uri)!.push(w.friendlyName);
    
    console.log(`${w.friendlyName}:`);
    console.log(`   contact_uri: ${attrs.contact_uri}`);
    console.log(`   email: ${attrs.email}`);
    console.log(`   phoneNumber: ${attrs.phoneNumber}`);
    console.log('');
  }

  // Check for duplicates
  console.log('═══════════════════════════════════════════');
  console.log('⚠️ DUPLICATE CONTACT URIs (if any)');
  console.log('═══════════════════════════════════════════\n');

  let hasDuplicates = false;
  for (const [uri, workers] of contactUris) {
    if (workers.length > 1) {
      hasDuplicates = true;
      console.log(`❌ "${uri}" is used by MULTIPLE workers:`);
      for (const w of workers) {
        console.log(`   - ${w}`);
      }
    }
  }

  if (!hasDuplicates) {
    console.log('✅ No duplicate contact_uris found');
  }
}

check().catch(console.error);
