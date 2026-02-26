/**
 * Explicit Cell Cancellation Endpoint
 * 
 * Called by the browser when the agent accepts the call (clicks Accept in the UI).
 * Proactively cancels any ringing cell phone leg immediately.
 * 
 * This is NOT event-driven (waiting for Twilio callbacks).
 * This IS API-driven (actively canceling via Twilio REST).
 */

import twilio from 'twilio';
import { getSimringContext } from '@/lib/simring-cache';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

export async function POST(req: Request) {
  try {
    const { reservationSid } = await req.json();

    console.log('═══════════════════════════════════════════');
    console.log('📞 EXPLICIT CELL CANCELLATION');
    console.log('ReservationSid:', reservationSid);
    console.log('═══════════════════════════════════════════');

    if (!reservationSid) {
      console.warn('❌ Missing reservationSid in request body');
      return Response.json(
        { error: 'Missing reservationSid', ok: false },
        { status: 400 }
      );
    }

    // Step 1: Get cellCallSid from cache (reliable)
    const simringContext = await getSimringContext(reservationSid);

    if (!simringContext?.cellCallSid) {
      console.log('ℹ️ No cached cellCallSid for this reservation — either no simring or already cleaned');
      return Response.json({ ok: true, canceled: false, reason: 'No cellCallSid in cache' });
    }

    const cellCallSid = simringContext.cellCallSid;
    console.log(`🔍 Found cellCallSid in cache: ${cellCallSid}`);

    // Step 2: Fetch current call status
    const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
    let callStatus = '';

    try {
      const call = await client.calls(cellCallSid).fetch();
      callStatus = call.status;
      console.log(`📞 Cell call status: ${call.status}`);
    } catch (err) {
      // Call might not exist anymore — that's fine
      console.log(`ℹ️ Cell call ${cellCallSid} not found (already ended):`, (err as Error).message);
      return Response.json({ ok: true, canceled: false, reason: 'Call already ended' });
    }

    // Step 3: Cancel if still in ringing/queued state
    if (['ringing', 'initiated', 'queued'].includes(callStatus)) {
      console.log(`📵 Cell is still ringing — canceling now`);
      try {
        await client.calls(cellCallSid).update({ status: 'canceled' });
        console.log(`✅ Cell call ${cellCallSid} canceled`);
        return Response.json({ ok: true, canceled: true });
      } catch (err) {
        console.error(`❌ Failed to cancel cell call:`, (err as Error).message);
        return Response.json(
          { ok: false, error: 'Failed to cancel cell call' },
          { status: 500 }
        );
      }
    }

    // Step 4: If in-progress, let it complete (agent answered, then browser also answered)
    if (callStatus === 'in-progress') {
      console.log(`ℹ️ Cell is already in-progress — leaving it (agent accepted on cell)`);
      return Response.json({ ok: true, canceled: false, reason: 'Cell already answered' });
    }

    // Step 5: If already ended, that's fine
    if (['completed', 'canceled', 'failed', 'no-answer', 'busy'].includes(callStatus)) {
      console.log(`ℹ️ Cell already ${callStatus} — no action needed`);
      return Response.json({ ok: true, canceled: false, reason: `Cell already ${callStatus}` });
    }

    console.log(`⚠️ Cell in unknown state: ${callStatus}`);
    return Response.json({ ok: true, canceled: false, reason: `Unknown status: ${callStatus}` });
  } catch (error) {
    console.error('❌ simring-cancel-cell error:', error);
    return Response.json(
      { error: 'Internal server error', ok: false },
      { status: 500 }
    );
  }
}
