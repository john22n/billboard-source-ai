import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function check() {
  console.log('═══════════════════════════════════════════');
  console.log('⚠️ TWILIO ALERTS DETAIL');
  console.log('═══════════════════════════════════════════\n');

  const alerts = await client.monitor.v1.alerts.list({ limit: 5 });
  
  for (const alert of alerts) {
    const detail = await client.monitor.v1.alerts(alert.sid).fetch();
    console.log(`Time: ${detail.dateCreated}`);
    console.log(`Error Code: ${detail.errorCode}`);
    console.log(`Log Level: ${detail.logLevel}`);
    console.log(`Alert Text: ${detail.alertText}`);
    console.log(`Request URL: ${detail.requestUrl}`);
    console.log(`Request Method: ${detail.requestMethod}`);
    console.log(`Response Body: ${detail.responseBody}`);
    console.log(`More Info: https://www.twilio.com/docs/errors/${detail.errorCode}`);
    console.log('═══════════════════════════════════════════\n');
  }
}

check().catch(console.error);
