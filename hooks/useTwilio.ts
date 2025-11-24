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

  // Initialize Twilio Device on mount
  useEffect(() => {
    const initTwilio = async () => {
      try {
        console.log('═══════════════════════════════════════════');
        console.log('🚀 TWILIO INITIALIZATION STARTING');
        console.log('═══════════════════════════════════════════');

        setStatus("Initializing Twilio...");

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
          return;
        }

        const email = data.identity;
        if (!email) {
          console.error('❌ No identity in token');
          setStatus("Error: No user identity in token");
          return;
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
          console.log('Call object:', call);

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
          console.log('═══════════════════════════════════════════');
          console.log('✅ DEVICE REGISTERED SUCCESSFULLY');
          console.log('═══════════════════════════════════════════');
          console.log('Identity:', email);
          console.log('Device state:', device.state);
          console.log('Device token:', device.token ? 'Present' : 'Missing');
          console.log('═══════════════════════════════════════════');

          setTwilioReady(true);
          setStatus(`Ready to receive calls`);
        });

        device.on('unregistered', () => {
          console.warn('⚠️ Device unregistered');
          setTwilioReady(false);
        });

        device.on('error', (error: Error) => {
          console.error('═══════════════════════════════════════════');
          console.error('❌ DEVICE ERROR:', error);
          console.error('Error name:', error.name);
          console.error('Error message:', error.message);
          console.error('Error code:', (error as any).code);
          console.error('═══════════════════════════════════════════');
          setStatus(`Twilio error: ${error.message}`);
        });

        device.on('tokenWillExpire', () => {
          console.warn('⚠️ Token will expire soon');
        });

        console.log('7️⃣ Event listeners set up, registering device...');
        await device.register();
        console.log('8️⃣ Device.register() called successfully');

        twilioDevice.current = device;

        // Make device accessible for debugging
        if (typeof window !== 'undefined') {
          (window as any).twilioDevice = twilioDevice;
        }

        console.log('9️⃣ Device stored in ref and window');
        console.log('═══════════════════════════════════════════');
        console.log('✅ INITIALIZATION COMPLETE');
        console.log('Device state:', device.state);
        console.log('Waiting for incoming calls...');
        console.log('═══════════════════════════════════════════');

      } catch (error) {
        console.error('═══════════════════════════════════════════');
        console.error('❌ INITIALIZATION FAILED');
        console.error('Error:', error);
        console.error('═══════════════════════════════════════════');
        setStatus("Twilio initialization failed");
      }
    };

    initTwilio();

    return () => {
      console.log('🧹 Cleaning up Twilio device');
      twilioDevice.current?.destroy();
    };
  }, []); // Empty deps - only run once on mount

  // Accept incoming call
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

  // Reject incoming call
  const rejectCall = useCallback(() => {
    if (incomingCall) {
      console.log('🚫 Rejecting call');
      incomingCall.reject();
      setIncomingCall(null);
      setStatus(twilioReady ? "Ready to receive calls" : "Idle");
    }
  }, [incomingCall, twilioReady]);

  // Hang up active call
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
  };
}
