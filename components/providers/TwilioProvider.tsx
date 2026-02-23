"use client";

import { createContext, useContext, useRef, useState, useEffect, useCallback, ReactNode } from "react";
import { Device, Call } from '@twilio/voice-sdk';
import { useWorkerStatus, type WorkerActivity } from "@/hooks/useWorkerStatus";

interface TwilioContextType {
  status: string;
  twilioReady: boolean;
  incomingCall: Call | null;
  callActive: boolean;
  userEmail: string;
  deviceError: string | null;
  isDestroyed: boolean;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  hangupCall: () => void;
  destroyDevice: () => void;
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

  // ✅ Refs to store cell call info passed from assignment callback
  const cellCallSidRef = useRef<string>('');
  const conferenceNameRef = useRef<string>('');
  const reservationSidRef = useRef<string>('');

  const onCallAcceptedRef = useRef<((call: Call) => void) | null>(null);
  const onCallDisconnectedRef = useRef<(() => void) | null>(null);

  const { status: workerStatus } = useWorkerStatus();

  useEffect(() => {
    console.log('👷 Worker status in TwilioProvider:', workerStatus);
  }, [workerStatus]);

  const [status, setStatus] = useState("Idle");
  const [twilioReady, setTwilioReady] = useState(false);
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  const [callActive, setCallActive] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [isDestroyed, setIsDestroyed] = useState(false);

  const getReadyStatus = useCallback(() => {
    console.log('🔍 getReadyStatus called, workerStatus:', workerStatus);
    if (workerStatus === 'available') {
      return 'Ready to receive calls';
    }
    return 'Offline';
  }, [workerStatus]);

  // ✅ Helper to cancel the cell leg via our API endpoint
  const cancelCellLeg = useCallback(async (reason: string) => {
    const sid = cellCallSidRef.current;
    if (!sid) {
      console.log(`ℹ️ No cellCallSid to cancel (${reason})`);
      return;
    }
    console.log(`📵 Canceling cell leg ${sid} (${reason})`);
    try {
      await fetch('/api/taskrouter/cancel-cell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cellCallSid: sid }),
      });
      console.log(`✅ Cell leg cancel request sent (${reason})`);
    } catch (err) {
      console.error(`⚠️ Failed to cancel cell leg (${reason}):`, err);
    } finally {
      // Clear refs after use
      cellCallSidRef.current = '';
      conferenceNameRef.current = '';
      reservationSidRef.current = '';
    }
  }, []);

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
      console.log('🚀 TWILIO INITIALIZATION STARTING (Provider)');
      console.log('Environment:', process.env.NODE_ENV);
      console.log('Timestamp:', new Date().toISOString());
      console.log('═══════════════════════════════════════════');

      setStatus("Initializing Twilio...");

      if (twilioDevice.current && twilioDevice.current.state !== 'destroyed') {
        console.log('🧹 Destroying previous device...');
        twilioDevice.current.destroy();
        twilioDevice.current = null;
      }

      console.log('1️⃣ Fetching token from /api/twilio-token...');
      const response = await fetch('/api/twilio-token');
      console.log('2️⃣ Token response status:', response.status);

      const data = await response.json();
      console.log('3️⃣ Token data received:', {
        hasToken: !!data.token,
        identity: data.identity,
        error: data.error
      });

      if (data.error) {
        console.error('❌ Token error:', data.error);
        setStatus(`Token error: ${data.error}`);
        setDeviceError(`Failed to get access token: ${data.error}`);
        return false;
      }

      const email = data.identity;
      if (!email) {
        console.error('❌ No identity in token');
        setStatus("Error: No user identity in token");
        setDeviceError('No user identity found. Please log in again.');
        return false;
      }

      setUserEmail(email);
      console.log('4️⃣ User identity:', email);

      console.log('5️⃣ Creating Device with token...');
      const device = new Device(data.token, {
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
      });

      console.log('6️⃣ Device created, setting up event listeners...');

      device.on('incoming', (call) => {
        console.log('═══════════════════════════════════════════');
        console.log('📞 INCOMING CALL EVENT FIRED!');
        console.log('═══════════════════════════════════════════');
        console.log('Call parameters:', {
          from: call.parameters.From,
          to: call.parameters.To,
          callSid: call.parameters.CallSid,
        });

        // ✅ Capture cell call info from custom parameters set by assignment callback
        cellCallSidRef.current = call.customParameters?.get('cellCallSid') || '';
        conferenceNameRef.current = call.customParameters?.get('conferenceName') || '';
        reservationSidRef.current = call.customParameters?.get('reservationSid') || '';

        console.log('📱 Cell call SID from custom params:', cellCallSidRef.current || 'none (not a simring call)');
        console.log('🏠 Conference name from custom params:', conferenceNameRef.current || 'none');

        setIncomingCall(call);
        setStatus(`Incoming call from ${call.parameters.From}`);

        call.on('disconnect', () => {
          console.log('📴 Call disconnected');
          setCallActive(false);
          setIncomingCall(null);
          activeCall.current = null;
          // Clear cell refs on disconnect too
          cellCallSidRef.current = '';
          conferenceNameRef.current = '';
          reservationSidRef.current = '';
          onCallDisconnectedRef.current?.();
        });

        call.on('accept', () => {
          console.log('✅ Call accepted event fired');
        });

        call.on('reject', () => {
          console.log('🚫 Call rejected');
          setIncomingCall(null);
        });

        call.on('cancel', () => {
          console.log('📵 Call canceled (caller hung up)');
          setIncomingCall(null);
          setStatus('Call canceled');
          // Clear cell refs on cancel too
          cellCallSidRef.current = '';
          conferenceNameRef.current = '';
          reservationSidRef.current = '';
        });

        call.on('error', (error: Error) => {
          console.error('❌ Call error:', error);
          setIncomingCall(null);
        });
      });

      device.on('registered', () => {
        registrationTime.current = Date.now();

        console.log('═══════════════════════════════════════════');
        console.log('✅ DEVICE REGISTERED SUCCESSFULLY (Provider)');
        console.log('═══════════════════════════════════════════');
        console.log('Identity:', email);
        console.log('Device state:', device.state);
        console.log('Device token:', device.token ? 'Present' : 'Missing');
        console.log('Registration time:', new Date(registrationTime.current).toISOString());
        console.log('Edge:', device.edge || 'unknown');
        console.log('═══════════════════════════════════════════');

        setTwilioReady(true);
        setStatus(getReadyStatus());
        setDeviceError(null);
        setIsDestroyed(false);
        hasInitialized.current = true;
      });

      device.on('unregistered', () => {
        const durationMs = Date.now() - registrationTime.current;
        const durationSec = (durationMs / 1000).toFixed(2);

        console.log('═══════════════════════════════════════════');
        console.warn('⚠️ DEVICE UNREGISTERED (Provider)');
        console.log('═══════════════════════════════════════════');
        console.log('Time since registration:', durationSec, 'seconds');
        console.log('Current device state:', device.state);
        console.log('Was registered at:', new Date(registrationTime.current).toISOString());
        console.log('Unregistered at:', new Date().toISOString());
        console.log('═══════════════════════════════════════════');

        setTwilioReady(false);

        if (durationMs < 2000) {
          console.error('❌ UNREGISTERED IMMEDIATELY - Possible causes:');
          console.error('  1. Another device with same identity registered');
          console.error('  2. Multiple tabs open');
          console.error('  3. Token validation failed');
          setDeviceError('Device unregistered immediately. Check for multiple tabs or identity conflicts.');
        }
      });

      device.on('error', (error: Error) => {
        console.error('═══════════════════════════════════════════');
        console.error('❌ DEVICE ERROR:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', (error as unknown as { code?: number }).code);
        console.error('Timestamp:', new Date().toISOString());
        console.error('═══════════════════════════════════════════');
        setStatus(`Twilio error: ${error.message}`);
        setDeviceError(`Twilio error: ${error.message}`);
      });

      device.on('tokenWillExpire', () => {
        console.warn('⚠️ Token will expire soon - reinitializing...');
        hasInitialized.current = false;
        setTimeout(() => initTwilio(), 1000);
      });

      console.log('7️⃣ Event listeners set up, registering device...');
      await device.register();
      console.log('8️⃣ Device.register() called successfully');

      twilioDevice.current = device;

      if (typeof window !== 'undefined') {
        (window as unknown as { twilioDevice: typeof twilioDevice }).twilioDevice = twilioDevice;

        console.log('🔍 DEBUGGING INFO:');
        console.log('Window location:', window.location.href);
        console.log('User agent:', navigator.userAgent);
        console.log('Online:', navigator.onLine);
      }

      console.log('9️⃣ Device stored in ref and window');
      console.log('═══════════════════════════════════════════');
      console.log('✅ INITIALIZATION COMPLETE (Provider)');
      console.log('Device state:', device.state);
      console.log('Waiting for incoming calls...');
      console.log('═══════════════════════════════════════════');

      return true;

    } catch (error) {
      console.error('═══════════════════════════════════════════');
      console.error('❌ INITIALIZATION FAILED');
      console.error('Error:', error);
      console.error('═══════════════════════════════════════════');
      setStatus("Twilio initialization failed");
      setDeviceError(`Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    } finally {
      isInitializing.current = false;
    }
  }, []);

  useEffect(() => {
    console.log('🎬 TwilioProvider mounted - initializing device');
    console.log('Environment:', process.env.NODE_ENV);
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

  useEffect(() => {
    console.log('🔄 Worker status changed:', {
      workerStatus,
      twilioReady,
      incomingCall: !!incomingCall,
      callActive,
    });
    if (twilioReady && !incomingCall && !callActive) {
      const newStatus = getReadyStatus();
      console.log('📝 Updating Twilio status to:', newStatus);
      setStatus(newStatus);
    } else {
      console.log('⏸️ Not updating status because conditions not met');
    }
  }, [workerStatus, twilioReady, incomingCall, callActive, getReadyStatus]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall) {
      console.error('❌ acceptCall called but no incoming call');
      return;
    }

    try {
      console.log('═══════════════════════════════════════════');
      console.log('📞 ACCEPTING CALL');
      console.log('═══════════════════════════════════════════');

      setStatus("Accepting call...");

      incomingCall.on('accept', () => {
        console.log('✅ Call accept event - call is connected');
        console.log('🎤 Triggering onCallAccepted callback');
        onCallAcceptedRef.current?.(incomingCall);
      });

      console.log('Calling incomingCall.accept()...');
      await incomingCall.accept();
      console.log('✅ accept() completed');

      activeCall.current = incomingCall;
      setCallActive(true);
      setIncomingCall(null);

      console.log('Call active, state updated');

    } catch (error) {
      console.error('❌ Error accepting call:', error);
      setStatus("Failed to accept call");
    }
  }, [incomingCall]);

  // ✅ rejectCall now also cancels the cell leg since conference-end won't fire
  const rejectCall = useCallback(() => {
    if (incomingCall) {
      console.log('🚫 Rejecting call');
      incomingCall.reject();
      setIncomingCall(null);
      setStatus(twilioReady ? getReadyStatus() : "Idle");

      // Cancel the cell leg — conference never forms on reject so conference-end won't fire
      cancelCellLeg('app-rejected');
    }
  }, [incomingCall, twilioReady, getReadyStatus, cancelCellLeg]);

  // ✅ hangupCall now also cancels the cell leg as a safety net
  // (conference-end should handle this too, but this ensures immediate cancellation)
  const hangupCall = useCallback(() => {
    if (activeCall.current) {
      console.log('📴 Hanging up call');
      activeCall.current.disconnect();
      activeCall.current = null;
      setCallActive(false);
      onCallDisconnectedRef.current?.();

      // Cancel the cell leg as a safety net in case conference-end is delayed/missed
      cancelCellLeg('app-hangup');
    }
  }, [cancelCellLeg]);

  const destroyDevice = useCallback(() => {
    console.log('🧹 Destroying Twilio device for logout');
    if (activeCall.current) {
      activeCall.current.disconnect();
      activeCall.current = null;
    }
    if (twilioDevice.current && twilioDevice.current.state !== 'destroyed') {
      twilioDevice.current.destroy();
      twilioDevice.current = null;
    }
    setTwilioReady(false);
    setIncomingCall(null);
    setCallActive(false);
    setDeviceError(null);
    setStatus('Idle');
    hasInitialized.current = false;
    cellCallSidRef.current = '';
    conferenceNameRef.current = '';
    reservationSidRef.current = '';
  }, []);

  const updateStatus = useCallback((newStatus: string) => {
    setStatus(newStatus);
  }, []);

  const resetStatus = useCallback(() => {
    setStatus(twilioReady ? getReadyStatus() : "Idle");
  }, [twilioReady, getReadyStatus]);

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
    acceptCall,
    rejectCall,
    hangupCall,
    destroyDevice,
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