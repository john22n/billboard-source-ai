"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Device, Call } from '@twilio/voice-sdk';

interface UseTwilioOptions {
  onCallAccepted?: (call: Call) => void;
  onCallDisconnected?: () => void;
}

export function useTwilio(options: UseTwilioOptions = {}) {
  const twilioDevice = useRef<Device | null>(null);
  const activeCall = useRef<Call | null>(null);
  const isInitializing = useRef(false);
  const hasInitialized = useRef(false);
  const registrationTime = useRef<number>(0);

  const onCallAcceptedRef = useRef(options.onCallAccepted);
  const onCallDisconnectedRef = useRef(options.onCallDisconnected);

  useEffect(() => {
    onCallAcceptedRef.current = options.onCallAccepted;
    onCallDisconnectedRef.current = options.onCallDisconnected;
  }, [options.onCallAccepted, options.onCallDisconnected]);

  const [status, setStatus] = useState("Idle");
  const [twilioReady, setTwilioReady] = useState(false);
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  const [callActive, setCallActive] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [isDestroyed, setIsDestroyed] = useState(false);

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
      console.log('Environment:', process.env.NODE_ENV);
      console.log('Timestamp:', new Date().toISOString());
      console.log('═══════════════════════════════════════════');

      setStatus("Initializing Twilio...");

      // Destroy existing device
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

      // CRITICAL: Set up incoming BEFORE registering
      device.on('incoming', (call) => {
        console.log('═══════════════════════════════════════════');
        console.log('📞 INCOMING CALL EVENT FIRED!');
        console.log('═══════════════════════════════════════════');
        console.log('Call parameters:', {
          from: call.parameters.From,
          to: call.parameters.To,
          callSid: call.parameters.CallSid,
        });

        setIncomingCall(call);
        setStatus(`Incoming call from ${call.parameters.From}`);

        call.on('disconnect', () => {
          console.log('📴 Call disconnected');
          setCallActive(false);
          setIncomingCall(null);
          activeCall.current = null;
          onCallDisconnectedRef.current?.();
        });

        call.on('accept', () => {
          console.log('✅ Call accepted event fired');
        });

        call.on('reject', () => {
          console.log('🚫 Call rejected');
        });

        call.on('error', (error: Error) => {
          console.error('❌ Call error:', error);
        });
      });

      device.on('registered', () => {
        registrationTime.current = Date.now();

        console.log('═══════════════════════════════════════════');
        console.log('✅ DEVICE REGISTERED SUCCESSFULLY');
        console.log('═══════════════════════════════════════════');
        console.log('Identity:', email);
        console.log('Device state:', device.state);
        console.log('Device token:', device.token ? 'Present' : 'Missing');
        console.log('Registration time:', new Date(registrationTime.current).toISOString());
        console.log('Edge:', device.edge || 'unknown');
        console.log('═══════════════════════════════════════════');

        setTwilioReady(true);
        setStatus(`Ready to receive calls`);
        setDeviceError(null);
        setIsDestroyed(false);
        hasInitialized.current = true;
      });

      device.on('unregistered', () => {
        const durationMs = Date.now() - registrationTime.current;
        const durationSec = (durationMs / 1000).toFixed(2);

        console.log('═══════════════════════════════════════════');
        console.warn('⚠️ DEVICE UNREGISTERED');
        console.log('═══════════════════════════════════════════');
        console.log('Time since registration:', durationSec, 'seconds');
        console.log('Current device state:', device.state);
        console.log('Was registered at:', new Date(registrationTime.current).toISOString());
        console.log('Unregistered at:', new Date().toISOString());
        console.log('═══════════════════════════════════════════');

        setTwilioReady(false);

        // If it happened very quickly (< 2 seconds), likely an identity conflict
        if (durationMs < 2000) {
          console.error('❌ UNREGISTERED IMMEDIATELY - Possible causes:');
          console.error('  1. Another device with same identity registered');
          console.error('  2. Multiple tabs open');
          console.error('  3. Token validation failed');
          setDeviceError('Device unregistered immediately. Check for multiple tabs or identity conflicts.');
        } else if (twilioReady) {
          setDeviceError('Device was unregistered unexpectedly.');
        }
      });

      device.on('error', (error: Error) => {
        console.error('═══════════════════════════════════════════');
        console.error('❌ DEVICE ERROR:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', (error as any).code);
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

      // Make device accessible for debugging
      if (typeof window !== 'undefined') {
        (window as any).twilioDevice = twilioDevice;

        // ✅ Also log token info for debugging
        console.log('🔍 DEBUGGING INFO:');
        console.log('Window location:', window.location.href);
        console.log('User agent:', navigator.userAgent);
        console.log('Online:', navigator.onLine);
      }

      console.log('9️⃣ Device stored in ref and window');
      console.log('═══════════════════════════════════════════');
      console.log('✅ INITIALIZATION COMPLETE');
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
  }, [twilioReady]);

  useEffect(() => {
    console.log('🎬 Component mounted - useEffect running');
    console.log('Environment:', process.env.NODE_ENV);

    initTwilio();

    return () => {
      console.log('═══════════════════════════════════════════');
      console.log('🧹 CLEANUP FUNCTION TRIGGERED');
      console.log('Environment:', process.env.NODE_ENV);
      console.log('Timestamp:', new Date().toISOString());
      console.log('═══════════════════════════════════════════');

      if (twilioDevice.current) {
        const state = twilioDevice.current.state;
        console.log('Device state before cleanup:', state);

        if (state !== 'destroyed') {
          console.log('🧹 Destroying device...');
          twilioDevice.current.destroy();
          console.log('✅ Device destroyed');
        } else {
          console.log('⚠️ Device already destroyed, skipping');
        }
      } else {
        console.log('⚠️ No device to clean up');
      }

      console.log('═══════════════════════════════════════════');
    };
  }, []); // Empty deps - only run once on mount

  // Monitor device health
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
      console.log('═══════════════════════════════════════════');
      console.log('📞 ACCEPTING CALL');
      console.log('═══════════════════════════════════════════');

      setStatus("Accepting call...");

      incomingCall.on('accept', () => {
        console.log('✅ Call accept event - call is connected');
        setTimeout(() => {
          console.log('🎤 Triggering onCallAccepted callback');
          onCallAcceptedRef.current?.(incomingCall);
        }, 500);
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

  const rejectCall = useCallback(() => {
    if (incomingCall) {
      console.log('🚫 Rejecting call');
      incomingCall.reject();
      setIncomingCall(null);
      setStatus(twilioReady ? "Ready to receive calls" : "Idle");
    }
  }, [incomingCall, twilioReady]);

  const hangupCall = useCallback(() => {
    if (activeCall.current) {
      console.log('📴 Hanging up call');
      activeCall.current.disconnect();
      activeCall.current = null;
      setCallActive(false);
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

  return {
    status,
    twilioReady,
    incomingCall,
    callActive,
    userEmail,
    acceptCall,
    rejectCall,
    hangupCall,
    updateStatus,
    resetStatus,
    destroy: () => twilioDevice.current?.destroy(),
    deviceError,
    isDestroyed,
    reinitialize,
    clearDeviceError,
  };
}
