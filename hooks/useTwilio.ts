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

  // Store callbacks in refs to avoid re-running effects
  const onCallAcceptedRef = useRef(options.onCallAccepted);
  const onCallDisconnectedRef = useRef(options.onCallDisconnected);

  // Update refs when callbacks change
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
        setStatus("Initializing Twilio...");
        const response = await fetch('/api/twilio-token');
        const data = await response.json();

        if (data.error) {
          setStatus(`Token error: ${data.error}`);
          return;
        }

        const email = data.identity;
        if (!email) {
          setStatus("Error: No user identity in token");
          return;
        }

        setUserEmail(email);
        console.log(`Initializing Twilio for: ${email}`);

        const device = new Device(data.token, {
          codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
          enableRingingState: true,
        });

        device.on('registered', () => {
          console.log(`${email} registered and ready`);
          setTwilioReady(true);
          setStatus(`Ready to receive calls`);
        });

        device.on('incoming', (call) => {
          console.log('Incoming call from:', call.parameters.From);
          setIncomingCall(call);
          setStatus(`Incoming call from ${call.parameters.From}`);

          call.on('disconnect', () => {
            console.log('Call disconnected');
            setCallActive(false);
            setIncomingCall(null);
            activeCall.current = null;
            onCallDisconnectedRef.current?.();
          });
        });

        device.on('error', (error) => {
          console.error('Twilio Device error:', error);
          setStatus(`Twilio error: ${error.message}`);
        });

        await device.register();
        twilioDevice.current = device;

      } catch (error) {
        console.error('Failed to initialize Twilio:', error);
        setStatus("Twilio initialization failed");
      }
    };

    initTwilio();
    return () => { twilioDevice.current?.destroy(); };
  }, []); // Empty deps - only run once on mount

  // Accept incoming call
  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;

    try {
      setStatus("Accepting call...");

      // Set up event listener for when call is fully connected
      incomingCall.on('accept', () => {
        console.log('Call accepted and connected');
        // Give streams a moment to be ready
        setTimeout(() => {
          onCallAcceptedRef.current?.(incomingCall);
        }, 500);
      });

      // Accept the call
      await incomingCall.accept();
      activeCall.current = incomingCall;
      setCallActive(true);
      setIncomingCall(null);

    } catch (error) {
      console.error('Error accepting call:', error);
      setStatus("Failed to accept call");
    }
  }, [incomingCall]);

  // Reject incoming call
  const rejectCall = useCallback(() => {
    if (incomingCall) {
      incomingCall.reject();
      setIncomingCall(null);
      setStatus(twilioReady ? "Ready to receive calls" : "Idle");
    }
  }, [incomingCall, twilioReady]);

  // Hang up active call
  const hangupCall = useCallback(() => {
    if (activeCall.current) {
      activeCall.current.disconnect();
      activeCall.current = null;
      setCallActive(false);
      onCallDisconnectedRef.current?.();
    }
  }, []);

  // Update status externally
  const updateStatus = useCallback((newStatus: string) => {
    setStatus(newStatus);
  }, []);

  // Reset status to default
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
