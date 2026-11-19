import { z } from 'zod'

const channelName = 'lead-notification-pages'
const sessionEvent = 'lead-notification-session-change'
const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session') }),
  z.object({
    type: z.literal('clear'),
    userId: z.string(),
    id: z.string().min(1),
  }),
])

function openChannel() {
  try {
    return new BroadcastChannel(channelName)
  } catch {
    return null
  }
}

// Called by successful sign-in and before sign-out; never carries credentials.
export function announceNotificationSessionChange() {
  window.dispatchEvent(new Event(sessionEvent))
  const channel = openChannel()
  channel?.postMessage({ type: 'session' })
  channel?.close()
}

// The page owns this subscription across polling/SSE transitions.
export function createNotificationSync(
  userId: string,
  onClear: (id: string) => void,
  onSessionChange: () => void,
) {
  const channel = openChannel()
  channel?.addEventListener('message', (event) => {
    const parsed = messageSchema.safeParse(event.data)
    if (!parsed.success) return
    const message = parsed.data
    if (message.type === 'session') onSessionChange()
    else if (message.userId === userId) onClear(message.id)
  })
  window.addEventListener(sessionEvent, onSessionChange)
  return {
    clear(id: string) {
      onClear(id)
      channel?.postMessage({ type: 'clear', userId, id })
    },
    dispose() {
      channel?.close()
      window.removeEventListener(sessionEvent, onSessionChange)
    },
  }
}
