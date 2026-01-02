/**
 * Check Twilio Alerts/Errors
 * 
 * Run with: npx dotenv -e .env.prod -- tsx scripts/check-errors.ts
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function checkErrors() {
  console.log('═══════════════════════════════════════════');
  console.log('📋 RECENT TWILIO ALERTS');
  console.log('═══════════════════════════════════════════');
  
  const alerts = await client.monitor.v1.alerts.list({ limit: 10 });
  
  if (alerts.length === 0) {
    console.log('No recent alerts');
    return;
  }
  
  for (const alert of alerts) {
    console.log(`\n${alert.dateCreated}`);
    console.log(`  Error Code: ${alert.errorCode}`);
    console.log(`  Log Level: ${alert.logLevel}`);
    console.log(`  Alert Text: ${alert.alertText?.substring(0, 200)}`);
    console.log(`  More Info: ${alert.moreInfo}`);
  }
}

checkErrors()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
