'use client'

import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react'
import { Device, Call } from '@twilio/voice-sdk'
import { useWorkerStatus, type WorkerActivity } from '@/hooks/useWorkerStatus'
import { publicConfig } from '@/lib/public-config'

interface TwilioContextType {
  status: string
  twilioReady: boolean
  incomingCall: Call | null
  callActive: boolean
  userEmail: string
  deviceError: string | null
  acceptCall: () => Promise<void>
  rejectCall: () => void
  hangupCall: () => void
  destroyDevice: () => void
  updateStatus: (status: string) => void
  resetStatus: () => void
  clearDeviceError: () => void
  onCallAccepted: (callback: (call: Call) => void) => void
  onCallDisconnected: (callback: () => void) => void
}

const TwilioContext = createContext<TwilioContextType | null>(null)

export function useTwilioContext() {
  const context = useContext(TwilioContext)
  if (!context) {
    throw new Error('useTwilioContext must be used within TwilioProvider')
  }
  return context
}

interface TwilioProviderProps {
  children: ReactNode
}

export function TwilioProvider({ children }: TwilioProviderProps) {
  const twilioDevice = useRef<Device | null>(null)
  const activeCall = useRef<Call | null>(null)
  const acceptingCall = useRef<Call | null>(null)
  const incomingNotification = useRef<Notification | null>(null)
  const isInitializing = useRef(false)
  const hasInitialized = useRef(false)
  const registrationTime = useRef<number>(0)
  const isLoggedOut = useRef(false)

  const onCallAcceptedRef = useRef<((call: Call) => void) | null>(null)
  const onCallDisconnectedRef = useRef<(() => void) | null>(null)

  // Get worker status to determine if user is available for calls
  const { status: workerStatus, setStatus: setWorkerStatus } = useWorkerStatus()
  const workerStatusRef = useRef(workerStatus)

  // Debug: Log worker status changes
  useEffect(() => {
    workerStatusRef.current = workerStatus
    console.log('👷 Worker status in TwilioProvider:', workerStatus)
  }, [workerStatus])

  const [status, setStatus] = useState('Idle')
  const [twilioReady, setTwilioReady] = useState(false)
  const [incomingCall, setIncomingCall] = useState<Call | null>(null)
  const [callActive, setCallActive] = useState(false)
  const [userEmail, setUserEmail] = useState<string>('')
  const [deviceError, setDeviceError] = useState<string | null>(null)

  const closeIncomingNotification = useCallback(() => {
    incomingNotification.current?.close()
    incomingNotification.current = null
  }, [])

  const acceptIncomingCall = useCallback(
    async (call: Call) => {
      if (activeCall.current === call || acceptingCall.current === call) return

      try {
        acceptingCall.current = call
        closeIncomingNotification()
        setStatus('Accepting call...')

        call.on('accept', () => {
          console.log('✅ Call accept event - call is connected')
          console.log('🎤 Triggering onCallAccepted callback')
          onCallAcceptedRef.current?.(call)
        })

        console.log('Calling incomingCall.accept()...')
        await call.accept()
        console.log('✅ accept() completed')

        activeCall.current = call
        setCallActive(true)
        setIncomingCall(null)
        console.log('Call active, state updated')
      } catch (error) {
        console.error('❌ Error accepting call:', error)
        setStatus('Failed to accept call')
      } finally {
        acceptingCall.current = null
      }
    },
    [closeIncomingNotification],
  )

  // Helper to get appropriate status message based on worker availability
  const getReadyStatus = useCallback(() => {
    const currentWorkerStatus = workerStatusRef.current
    console.log('🔍 getReadyStatus called, workerStatus:', currentWorkerStatus)
    if (currentWorkerStatus === 'available') {
      console.log('✅ Worker is available, returning "Ready to receive calls"')
      return 'Ready to receive calls'
    }
    console.log('❌ Worker not available, returning "Offline"')
    return 'Offline'
  }, [])

  const initTwilio = useCallback(async () => {
    if (isLoggedOut.current) return false
    if (isInitializing.current) {
      console.log('⚠️ Init already in progress')
      return false
    }

    if (
      hasInitialized.current &&
      twilioDevice.current?.state === 'registered'
    ) {
      console.log('⚠️ Already initialized and registered')
      return true
    }

    try {
      isInitializing.current = true
      setDeviceError(null)

      console.log('═══════════════════════════════════════════')
      console.log('🚀 TWILIO INITIALIZATION STARTING (Provider)')
      console.log('Environment:', publicConfig.runtime.nodeEnv)
      console.log('Timestamp:', new Date().toISOString())
      console.log('═══════════════════════════════════════════')

      setStatus('Initializing Twilio...')

      if (twilioDevice.current && twilioDevice.current.state !== 'destroyed') {
        console.log('🧹 Destroying previous device...')
        twilioDevice.current.destroy()
        twilioDevice.current = null
      }

      console.log('1️⃣ Fetching token from /api/twilio-token...')
      const response = await fetch('/api/twilio-token')
      console.log('2️⃣ Token response status:', response.status)

      const data = await response.json()
      console.log('3️⃣ Token data received:', {
        hasToken: !!data.token,
        identity: data.identity,
        error: data.error,
      })

      if (data.error) {
        console.error('❌ Token error:', data.error)
        setStatus(`Token error: ${data.error}`)
        setDeviceError(`Failed to get access token: ${data.error}`)
        return false
      }

      const email = data.identity
      if (!email) {
        console.error('❌ No identity in token')
        setStatus('Error: No user identity in token')
        setDeviceError('No user identity found. Please log in again.')
        return false
      }

      setUserEmail(email)
      console.log('4️⃣ User identity:', email)

      console.log('5️⃣ Creating Device with token...')
      const device = new Device(data.token, {
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
      })

      console.log('6️⃣ Device created, setting up event listeners...')

      device.on('incoming', (call) => {
        console.log('═══════════════════════════════════════════')
        console.log('📞 INCOMING CALL EVENT FIRED!')
        console.log('═══════════════════════════════════════════')
        console.log('Call parameters:', {
          from: call.parameters.From,
          to: call.parameters.To,
          callSid: call.parameters.CallSid,
        })

        setIncomingCall(call)
        setStatus(`Incoming call from ${call.parameters.From}`)

        if (
          document.visibilityState !== 'visible' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          closeIncomingNotification()
          const notification = new Notification('Incoming sales call', {
            body: `Call from ${call.parameters.From || 'Unknown caller'}. Click to answer.`,
            icon: '/favicon.ico',
            tag: 'incoming-sales-call',
            requireInteraction: true,
          })
          incomingNotification.current = notification
          notification.onclick = () => {
            window.focus()
            void acceptIncomingCall(call)
          }
        }

        call.on('disconnect', () => {
          console.log('📴 Call disconnected')
          closeIncomingNotification()
          setCallActive(false)
          setIncomingCall(null)
          activeCall.current = null
          onCallDisconnectedRef.current?.()
        })

        call.on('reject', () => {
          console.log('🚫 Call rejected')
          closeIncomingNotification()
          setIncomingCall(null)
        })

        call.on('cancel', () => {
          console.log('📵 Call canceled (caller hung up)')
          closeIncomingNotification()
          setIncomingCall(null)
          setStatus('Call canceled')
        })

        call.on('error', (error: Error) => {
          console.error('❌ Call error:', error)
          closeIncomingNotification()
          setIncomingCall(null)
        })
      })

      device.on('registered', () => {
        registrationTime.current = Date.now()

        console.log('═══════════════════════════════════════════')
        console.log('✅ DEVICE REGISTERED SUCCESSFULLY (Provider)')
        console.log('═══════════════════════════════════════════')
        console.log('Identity:', email)
        console.log('Device state:', device.state)
        console.log('Device token:', device.token ? 'Present' : 'Missing')
        console.log(
          'Registration time:',
          new Date(registrationTime.current).toISOString(),
        )
        console.log('Edge:', device.edge || 'unknown')
        console.log('═══════════════════════════════════════════')

        setTwilioReady(true)
        setStatus(getReadyStatus())
        setDeviceError(null)
        hasInitialized.current = true
      })

      device.on('unregistered', () => {
        if (isLoggedOut.current) return

        const durationMs = Date.now() - registrationTime.current
        const durationSec = (durationMs / 1000).toFixed(2)

        console.log('═══════════════════════════════════════════')
        console.warn('⚠️ DEVICE UNREGISTERED (Provider)')
        console.log('═══════════════════════════════════════════')
        console.log('Time since registration:', durationSec, 'seconds')
        console.log('Current device state:', device.state)
        console.log(
          'Was registered at:',
          new Date(registrationTime.current).toISOString(),
        )
        console.log('Unregistered at:', new Date().toISOString())
        console.log('═══════════════════════════════════════════')

        setTwilioReady(false)
        setStatus('Reconnecting calling service...')
        console.warn(
          'Twilio registration ended; preserving worker availability',
        )

        if (!isInitializing.current) {
          console.log('🔄 Re-registering existing Twilio device')
          isInitializing.current = true
          device
            .register()
            .catch((error) => {
              console.error('Failed to re-register Twilio device:', error)
            })
            .finally(() => {
              isInitializing.current = false
            })
        }
      })

      device.on('error', (error: Error) => {
        console.error('═══════════════════════════════════════════')
        console.error('❌ DEVICE ERROR:', error)
        console.error('Error name:', error.name)
        console.error('Error message:', error.message)
        console.error(
          'Error code:',
          (error as unknown as { code?: number }).code,
        )
        console.error('Timestamp:', new Date().toISOString())
        console.error('═══════════════════════════════════════════')
        setStatus(`Twilio error: ${error.message}`)
        setDeviceError(`Twilio error: ${error.message}`)
      })

      device.on('tokenWillExpire', () => {
        console.warn('⚠️ Twilio token will expire with the login session')
        void setWorkerStatus('offline').catch((error) => {
          console.error('Failed to set expiring worker offline:', error)
        })
      })

      console.log('7️⃣ Event listeners set up, registering device...')
      await device.register()
      console.log('8️⃣ Device.register() called successfully')

      twilioDevice.current = device

      if (typeof window !== 'undefined') {
        ;(
          window as unknown as { twilioDevice: typeof twilioDevice }
        ).twilioDevice = twilioDevice

        console.log('🔍 DEBUGGING INFO:')
        console.log('Window location:', window.location.href)
        console.log('User agent:', navigator.userAgent)
        console.log('Online:', navigator.onLine)
      }

      console.log('9️⃣ Device stored in ref and window')
      console.log('═══════════════════════════════════════════')
      console.log('✅ INITIALIZATION COMPLETE (Provider)')
      console.log('Device state:', device.state)
      console.log('Waiting for incoming calls...')
      console.log('═══════════════════════════════════════════')

      return true
    } catch (error) {
      console.error('═══════════════════════════════════════════')
      console.error('❌ INITIALIZATION FAILED')
      console.error('Error:', error)
      console.error('═══════════════════════════════════════════')
      setStatus('Twilio initialization failed')
      setDeviceError(
        `Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
      return false
    } finally {
      isInitializing.current = false
    }
  }, [
    acceptIncomingCall,
    closeIncomingNotification,
    getReadyStatus,
    setWorkerStatus,
  ])

  useEffect(() => {
    console.log('🎬 TwilioProvider mounted - initializing device')
    console.log('Environment:', publicConfig.runtime.nodeEnv)

    isLoggedOut.current = false
    initTwilio()

    // NO cleanup - device should persist for the lifetime of the app
    // Only destroy when user logs out explicitly
  }, [initTwilio])

  useEffect(() => {
    const checkInterval = setInterval(() => {
      if (isLoggedOut.current) return
      if (twilioDevice.current) {
        const state = twilioDevice.current.state

        if (state === 'destroyed' && hasInitialized.current) {
          console.error('⚠️ DEVICE WAS DESTROYED!')
          setTwilioReady(false)
          setDeviceError('Calling connection ended. Your login remains active.')
          setStatus('Calling unavailable')
          hasInitialized.current = false
        }
      }
    }, 2000)

    return () => clearInterval(checkInterval)
  }, [])

  // Update status when worker availability changes
  useEffect(() => {
    console.log('🔄 Worker status changed:', {
      workerStatus,
      twilioReady,
      incomingCall: !!incomingCall,
      callActive,
    })
    if (twilioReady && !incomingCall && !callActive) {
      const newStatus = getReadyStatus()
      console.log('📝 Updating Twilio status to:', newStatus)
      setStatus(newStatus)
    } else {
      console.log('⏸️ Not updating status because conditions not met')
    }
  }, [workerStatus, twilioReady, incomingCall, callActive, getReadyStatus])

  const acceptCall = useCallback(async () => {
    if (!incomingCall) {
      console.error('❌ acceptCall called but no incoming call')
      return
    }

    console.log('═══════════════════════════════════════════')
    console.log('📞 ACCEPTING CALL')
    console.log('═══════════════════════════════════════════')
    await acceptIncomingCall(incomingCall)
  }, [acceptIncomingCall, incomingCall])

  const rejectCall = useCallback(() => {
    if (incomingCall) {
      console.log('🚫 Rejecting call')

      // Record the explicit browser Reject as a Call Attempt Outcome.
      // Fire-and-forget; the server gates non-production traffic.
      fetch('/api/call-attempts/reject', {
        method: 'POST',
        keepalive: true,
      }).catch((err) => {
        console.error('Failed to record rejected call attempt:', err)
      })

      closeIncomingNotification()
      incomingCall.reject()
      setIncomingCall(null)
      setStatus(twilioReady ? getReadyStatus() : 'Idle')
    }
  }, [closeIncomingNotification, incomingCall, twilioReady, getReadyStatus])

  const hangupCall = useCallback(() => {
    if (activeCall.current) {
      console.log('📴 Hanging up call')
      activeCall.current.disconnect()
      activeCall.current = null
      setCallActive(false)
      onCallDisconnectedRef.current?.()
    }
  }, [])

  const destroyDevice = useCallback(() => {
    console.log('🧹 Destroying Twilio device for logout')
    isLoggedOut.current = true
    closeIncomingNotification()
    if (activeCall.current) {
      activeCall.current.disconnect()
      activeCall.current = null
    }
    if (twilioDevice.current && twilioDevice.current.state !== 'destroyed') {
      twilioDevice.current.destroy()
      twilioDevice.current = null
    }
    setTwilioReady(false)
    setIncomingCall(null)
    setCallActive(false)
    setDeviceError(null)
    setStatus('Idle')
    hasInitialized.current = false
  }, [closeIncomingNotification])

  const updateStatus = useCallback((newStatus: string) => {
    setStatus(newStatus)
  }, [])

  const resetStatus = useCallback(() => {
    setStatus(twilioReady ? getReadyStatus() : 'Idle')
  }, [twilioReady, getReadyStatus])

  const clearDeviceError = useCallback(() => {
    setDeviceError(null)
  }, [])

  const onCallAcceptedCallback = useCallback(
    (callback: (call: Call) => void) => {
      onCallAcceptedRef.current = callback
    },
    [],
  )

  const onCallDisconnectedCallback = useCallback((callback: () => void) => {
    onCallDisconnectedRef.current = callback
  }, [])

  const value: TwilioContextType = {
    status,
    twilioReady,
    incomingCall,
    callActive,
    userEmail,
    deviceError,
    acceptCall,
    rejectCall,
    hangupCall,
    destroyDevice,
    updateStatus,
    resetStatus,
    clearDeviceError,
    onCallAccepted: onCallAcceptedCallback,
    onCallDisconnected: onCallDisconnectedCallback,
  }

  return (
    <TwilioContext.Provider value={value}>{children}</TwilioContext.Provider>
  )
}
