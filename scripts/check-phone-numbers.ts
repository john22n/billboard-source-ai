import twilio from 'twilio'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!

const client = twilio(ACCOUNT_SID, AUTH_TOKEN)

async function check() {
  console.log('═══════════════════════════════════════════')
  console.log('📱 TWILIO PHONE NUMBER CONFIGURATION')
  console.log('═══════════════════════════════════════════\n')

  const phoneNumbers = await client.incomingPhoneNumbers.list()

  for (const pn of phoneNumbers) {
    console.log(`${pn.friendlyName} (${pn.phoneNumber}):`)
    console.log(`   SID: ${pn.sid}`)
    console.log(`   Voice URL: ${pn.voiceUrl}`)
    console.log(`   Voice Method: ${pn.voiceMethod}`)
    console.log(`   Voice Fallback URL: ${pn.voiceFallbackUrl}`)
    console.log(`   Status Callback: ${pn.statusCallback}`)
    console.log(`   Voice Caller ID Lookup: ${pn.voiceCallerIdLookup}`)
    console.log(`   Voice Application SID: ${pn.voiceApplicationSid || 'None'}`)
    console.log('')
  }

  // Check for trunk/SIP configuration that might limit concurrent calls
  console.log('═══════════════════════════════════════════')
  console.log('📊 ACCOUNT LIMITS')
  console.log('═══════════════════════════════════════════\n')

  try {
    const account = await client.api.accounts(ACCOUNT_SID).fetch()
    console.log('Account Status:', account.status)
    console.log('Account Type:', account.type)
  } catch {
    console.log('Could not fetch account details')
  }
}

check().catch(console.error)
