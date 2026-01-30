import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function check() {
  console.log('═══════════════════════════════════════════');
  console.log('⚠️ TWILIO ALERTS (last 20)');
  console.log('═══════════════════════════════════════════\n');

  try {
    const alerts = await client.monitor.v1.alerts.list({ limit: 20 });
    
    if (alerts.length === 0) {
      console.log('No recent alerts');
    } else {
      for (const alert of alerts) {
        console.log(`${alert.dateCreated}`);
        console.log(`   Error: ${alert.errorCode}`);
        console.log(`   Message: ${alert.alertText?.slice(0, 100)}`);
        console.log(`   URL: ${alert.requestUrl}`);
        console.log('');
      }
    }
  } catch (e) {
    console.log('Could not fetch alerts:', e);
  }
}

check().catch(console.error);
