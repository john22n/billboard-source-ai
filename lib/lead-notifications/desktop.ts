const permissionPromptKey = 'lead-alerts:permission-prompted'

function supportsDesktopAlerts() {
  return 'Notification' in window && Boolean(navigator.locks)
}

export function shouldPromptForNotifications() {
  try {
    return (
      supportsDesktopAlerts() &&
      Notification.permission === 'default' &&
      localStorage.getItem(permissionPromptKey) !== 'true'
    )
  } catch {
    return false
  }
}

export function dismissNotificationPrompt() {
  try {
    localStorage.setItem(permissionPromptKey, 'true')
  } catch {
    // Storage restrictions must not prevent dismissing the current prompt.
  }
}

// Called under the account's Web Lock so only one tab claims each banner.
function claimDesktopAlert(userId: string, id: string) {
  if (Notification.permission !== 'granted') return false
  const key = `lead-alerts:${userId}:shown`
  const shown: string[] = JSON.parse(localStorage.getItem(key) || '[]')
  if (shown.includes(id)) return false
  localStorage.setItem(key, JSON.stringify([...shown.slice(-499), id]))
  return true
}

export function createDesktopAlerts(
  userId: string,
  isCleared: (id: string) => boolean,
) {
  let generation = 0
  const banners = new Set<Notification>()

  async function show(item: {
    id: string
    companyName: string
    leadUrl: string
  }) {
    const queuedGeneration = generation
    try {
      if (!supportsDesktopAlerts()) return
      await navigator.locks.request(`lead-alerts:${userId}`, () => {
        if (queuedGeneration !== generation || isCleared(item.id)) return
        if (!claimDesktopAlert(userId, item.id)) return
        const banner = new Notification(item.companyName, {
          body: 'New Contact Us lead assigned to you',
          tag: `lead:${userId}:${item.id}`,
        })
        banners.add(banner)
        banner.onclose = () => banners.delete(banner)
        banner.onclick = () => {
          window.open(item.leadUrl, '_blank', 'noopener,noreferrer')
          banner.close()
        }
      })
    } catch {
      // Browser/storage restrictions must never interrupt the in-app inbox.
    }
  }

  function reset() {
    // An account returning later must not revive alerts queued before sign-out.
    generation++
    for (const banner of banners) banner.close()
    banners.clear()
  }

  return { show, reset }
}
