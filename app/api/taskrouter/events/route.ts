/**
 * TaskRouter Event Callback
 *
 * Logs TaskRouter events for debugging and monitoring.
 * Voicemail redirect is handled by the assignment callback using redirect instruction.
 */

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const eventType = formData.get('EventType') as string;
    const taskSid = formData.get('TaskSid') as string;
    const taskQueueName = formData.get('TaskQueueName') as string;
    const taskQueueSid = formData.get('TaskQueueSid') as string;
    const workerSid = formData.get('WorkerSid') as string;
    const reservationSid = formData.get('ReservationSid') as string;
    const taskAttributes = formData.get('TaskAttributes') as string;

    console.log('═══════════════════════════════════════════');
    console.log('📡 TASKROUTER EVENT');
    console.log('EventType:', eventType);
    console.log('TaskSid:', taskSid);
    console.log('TaskQueueName:', taskQueueName || 'N/A');
    console.log('TaskQueueSid:', taskQueueSid || 'N/A');
    console.log('WorkerSid:', workerSid || 'N/A');
    console.log('ReservationSid:', reservationSid || 'N/A');
    console.log('═══════════════════════════════════════════');

    switch (eventType) {
      case 'task.created':
        console.log('📋 Task created');
        break;

      case 'task-queue.entered':
        console.log(`📥 Task entered queue: ${taskQueueName}`);
        if (taskQueueName === 'Voicemail') {
          console.log('📼 Task entered Voicemail queue - assignment callback will handle redirect');
        }
        break;

      case 'reservation.created':
        console.log(`🔔 Reservation created for worker: ${workerSid}`);
        break;

      case 'reservation.accepted':
        console.log(`✅ Reservation accepted by worker: ${workerSid}`);
        break;

      case 'reservation.rejected':
        console.log(`🚫 Reservation rejected by worker: ${workerSid}`);
        break;

      case 'reservation.timeout':
        console.log(`⏰ Reservation timeout for worker: ${workerSid}`);
        break;

      case 'task.canceled':
        console.log('🗑️ Task canceled');
        console.log(
          'Reason:',
          formData.get('TaskCanceledReason') || 'unknown'
        );
        break;

      default:
        console.log('ℹ️ Unhandled event type');
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ TaskRouter event callback error:', error);
    return new Response(null, { status: 500 });
  }
}

