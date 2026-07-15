self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('notificationclick', (event) => {
  if (event.notification.tag !== 'incoming-sales-call') return

  event.notification.close()
  const action = event.action || 'accept'
  const callSid = event.notification.data?.callSid

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windowClients) => {
        const client =
          windowClients.find((candidate) => candidate.focused) ||
          windowClients.find(
            (candidate) => candidate.visibilityState === 'visible',
          ) ||
          windowClients[0]

        if (!client) return
        if (action === 'accept') await client.focus()
        client.postMessage({
          type: 'incoming-call-action',
          action,
          callSid,
        })
      }),
  )
})
