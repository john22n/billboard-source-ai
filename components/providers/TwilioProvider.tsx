"use client";

import { createContext, useContext, useRef, useState, useEffect, useCallback, ReactNode } from "react";
import { Device, Call } from '@twilio/voice-sdk';

interface TwilioContextType {
  status: string;
  twilioReady: boolean;
  incomingCall: Call | null;
  callActive: boolean;
  userEmail: string;
  deviceError: string | null;
  isDestroyed: boolean;
  originalCallerNumber: string;  // ✅ The REAL caller's phone number
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  hangupCall: () => void;
  updateStatus: (status: string) => void;
  resetStatus: () => void;
  reinitialize: () => Promise<boolean>;
  clearDeviceError: () => void;
  onCallAccepted: (callback: (call: Call) => void) => void;
  onCallDisconnected: (callback: () => void) => void;
}

const TwilioContext = createContext<TwilioContextType | null>(null);

export function useTwilioContext() {
  const context = useContext(TwilioContext);
  if (!context) {
    throw new Error('useTwilioContext must be used within TwilioProvider');
  }
  return context;
}

interface TwilioProviderProps {
  children: ReactNode;
}

export function TwilioProvider({ children }: TwilioProviderProps) {
  const twilioDevice = useRef<Device | null>(null);
  const activeCall = useRef<Call | null>(null);
  const isInitializing = useRef(false);
  const hasInitialized = useRef(false);
  const registrationTime = useRef<number>(0);

  const onCallAcceptedRef = useRef<((call: Call) => void) | null>(null);
  const onCallDisconnectedRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState("Idle");
  const [twilioReady, setTwilioReady] = useState(false);
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  const [callActive, setCallActive] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [isDestroyed, setIsDestroyed] = useState(false);
  const [originalCallerNumber, setOriginalCallerNumber] = useState<string>('');  // ✅ NEW

  const initTwilio = useCallback(async () => {
    if (isInitializing.current) {
      console.log('⚠️ Init already in progress');
      return false;
    }

    if (hasInitialized.current && twilioDevice.current?.state === 'registered') {
      console.log('⚠️ Already initialized and registered');
      return true;
    }

    try {
      isInitializing.current = true;
      setDeviceError(null);
      setIsDestroyed(false);

      console.log('═══════════════════════════════════════════');
      console.log('🚀 TWILIO INITIALIZATION STARTING');
      console.log('═══════════════════════════════════════════');

      setStatus("Initializing Twilio...");

      if (twilioDevice.current && twilioDevice.current.state !== 'destroyed') {
        twilioDevice.current.destroy();
        twilioDevice.current = null;
      }

      const response = await fetch('/api/twilio-token');
      const data = await response.json();

      if (data.error) {
        console.error('❌ Token error:', data.error);
        setStatus(`Token error: ${data.error}`);
        setDeviceError(`Failed to get access token: ${data.error}`);
        return false;
      }

      const email = data.identity;
      if (!email) {
        setStatus("Error: No user identity in token");
        setDeviceError('No user identity found. Please log in again.');
        return false;
      }

      setUserEmail(email);

      const device = new Device(data.token, {
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
      });

      // =========================================================================
      // INCOMING CALL HANDLER - Read originalFrom from customParameters
      // =========================================================================
      device.on('incoming', (call) => {
        console.log('═══════════════════════════════════════════');
        console.log('📞 INCOMING CALL EVENT');
        console.log('═══════════════════════════════════════════');
        
        // ✅ Get original caller from custom parameters (set by bridge-to-worker TwiML)
        const customOriginalFrom = call.customParameters?.get('originalFrom');
        const standardFrom = call.parameters.From;
        
        console.log('Standard From (Twilio internal):', standardFrom);
        console.log('Custom originalFrom (real caller):', customOriginalFrom);
        
        // Use custom parameter if available, fall back to standard
        const realCallerNumber = customOriginalFrom || standardFrom || 'Unknown';
        
        console.log('✅ Using caller number:', realCallerNumber);
        console.log('═══════════════════════════════════════════');

        // ✅ Store the REAL caller number
        setOriginalCallerNumber(realCallerNumber);
        
        setIncomingCall(call);
        setStatus(`Incoming call from ${realCallerNumber}`);

        call.on('disconnect', () => {
          console.log('📴 Call disconnected');
          setCallActive(false);
          setIncomingCall(null);
          activeCall.current = null;
          // Don't clear originalCallerNumber - keep it for form
          onCallDisconnectedRef.current?.();
        });

        call.on('accept', () => {
          console.log('✅ Call accepted');
        });

        call.on('reject', () => {
          console.log('🚫 Call rejected');
          setIncomingCall(null);
        });

        call.on('cancel', () => {
          console.log('📵 Call canceled');
          setIncomingCall(null);
          setStatus('Call canceled');
        });

        call.on('error', (error: Error) => {
          console.error('❌ Call error:', error);
          setIncomingCall(null);
        });
      });

      device.on('registered', () => {
        registrationTime.current = Date.now();
        console.log('✅ DEVICE REGISTERED');
        setTwilioReady(true);
        setStatus(`Ready to receive calls`);
        setDeviceError(null);
        setIsDestroyed(false);
        hasInitialized.current = true;
      });

      device.on('unregistered', () => {
        const durationMs = Date.now() - registrationTime.current;
        console.warn('⚠️ DEVICE UNREGISTERED after', (durationMs / 1000).toFixed(2), 'seconds');
        setTwilioReady(false);

        if (durationMs < 2000) {
          setDeviceError('Device unregistered immediately. Check for multiple tabs.');
        }
      });

      device.on('error', (error: Error) => {
        console.error('❌ DEVICE ERROR:', error);
        setStatus(`Twilio error: ${error.message}`);
        setDeviceError(`Twilio error: ${error.message}`);
      });

      device.on('tokenWillExpire', () => {
        console.warn('⚠️ Token will expire soon - reinitializing...');
        hasInitialized.current = false;
        setTimeout(() => initTwilio(), 1000);
      });

      await device.register();
      twilioDevice.current = device;

      if (typeof window !== 'undefined') {
        (window as unknown as { twilioDevice: typeof twilioDevice }).twilioDevice = twilioDevice;
      }

      console.log('✅ INITIALIZATION COMPLETE');
      return true;

    } catch (error) {
      console.error('❌ INITIALIZATION FAILED:', error);
      setStatus("Twilio initialization failed");
      setDeviceError(`Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    } finally {
      isInitializing.current = false;
    }
  }, []);

  useEffect(() => {
    initTwilio();
  }, [initTwilio]);

  useEffect(() => {
    const checkInterval = setInterval(() => {
      if (twilioDevice.current) {
        const state = twilioDevice.current.state;
        if (state === 'destroyed' && hasInitialized.current) {
          console.error('⚠️ DEVICE WAS DESTROYED!');
          setIsDestroyed(true);
          setTwilioReady(false);
          setDeviceError('Twilio device was destroyed. Click "Reinitialize" to fix.');
          setStatus('Device destroyed');
          hasInitialized.current = false;
        }
      }
    }, 2000);

    return () => clearInterval(checkInterval);
  }, []);

  const acceptCall = useCallback(async () => {
    if (!incomingCall) {
      console.error('❌ acceptCall called but no incoming call');
      return;
    }

    try {
      console.log('📞 ACCEPTING CALL');
      setStatus("Accepting call...");

      incomingCall.on('accept', () => {
        console.log('✅ Call connected');
        setTimeout(() => {
          onCallAcceptedRef.current?.(incomingCall);
        }, 500);
      });

      await incomingCall.accept();

      activeCall.current = incomingCall;
      setCallActive(true);
      setIncomingCall(null);

    } catch (error) {
      console.error('❌ Error accepting call:', error);
      setStatus("Failed to accept call");
    }
  }, [incomingCall]);

  const rejectCall = useCallback(() => {
    if (incomingCall) {
      console.log('🚫 Rejecting call');
      incomingCall.reject();
      setIncomingCall(null);
      setOriginalCallerNumber('');  // ✅ Clear on reject
      setStatus(twilioReady ? "Ready to receive calls" : "Idle");
    }
  }, [incomingCall, twilioReady]);

  const hangupCall = useCallback(() => {
    if (activeCall.current) {
      console.log('📴 Hanging up call');
      activeCall.current.disconnect();
      activeCall.current = null;
      setCallActive(false);
      // Don't clear originalCallerNumber - keep for form submission
      onCallDisconnectedRef.current?.();
    }
  }, []);

  const updateStatus = useCallback((newStatus: string) => {
    setStatus(newStatus);
  }, []);

  const resetStatus = useCallback(() => {
    setStatus(twilioReady ? "Ready to receive calls" : "Idle");
  }, [twilioReady]);

  const reinitialize = useCallback(async () => {
    console.log('🔄 Manual reinitialization requested');
    hasInitialized.current = false;
    return await initTwilio();
  }, [initTwilio]);

  const clearDeviceError = useCallback(() => {
    setDeviceError(null);
  }, []);

  const onCallAcceptedCallback = useCallback((callback: (call: Call) => void) => {
    onCallAcceptedRef.current = callback;
  }, []);

  const onCallDisconnectedCallback = useCallback((callback: () => void) => {
    onCallDisconnectedRef.current = callback;
  }, []);

  const value: TwilioContextType = {
    status,
    twilioReady,
    incomingCall,
    callActive,
    userEmail,
    deviceError,
    isDestroyed,
    originalCallerNumber,  // ✅ Expose the real caller number
    acceptCall,
    rejectCall,
    hangupCall,
    updateStatus,
    resetStatus,
    reinitialize,
    clearDeviceError,
    onCallAccepted: onCallAcceptedCallback,
    onCallDisconnected: onCallDisconnectedCallback,
  };

  return (
    <TwilioContext.Provider value={value}>
      {children}
    </TwilioContext.Provider>
  );
}