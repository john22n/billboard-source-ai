"use client";

import { useRef, useState, useCallback } from "react";
import { Call } from '@twilio/voice-sdk';
import type { TranscriptItem } from "@/types/sales-call";

interface UseOpenAITranscriptionOptions {
  onStatusChange?: (status: string) => void;
}

export function useOpenAITranscription(options: UseOpenAITranscriptionOptions = {}) {
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const sessionStartTime = useRef<number | null>(null);
  const logId = useRef<number | null>(null);

  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");

  const setStatus = useCallback((status: string) => {
    options.onStatusChange?.(status);
  }, [options]);

  // Start transcription with Twilio call audio
  const startTranscription = useCallback(async (call: Call) => {
    try {
      setStatus("Fetching OpenAI token...");
      const tokenResponse = await fetch("/api/token");
      const data = await tokenResponse.json();

      if (!data || !data.value) {
        console.error("Token fetch failed:", data);
        setStatus("Token fetch failed");
        return;
      }

      const EPHEMERAL_KEY = data.value;
      logId.current = data.logId;
      sessionStartTime.current = Date.now();
      console.log(`Session started - Log ID: ${logId.current}`);

      setStatus("Starting peer connection...");
      const pc = new RTCPeerConnection();
      peerConnection.current = pc;

      audioElement.current = document.createElement("audio");
      audioElement.current.autoplay = true;

      pc.ontrack = (e) => {
        console.log("Remote track received");
        audioElement.current!.srcObject = e.streams[0];
      };

      // Get BOTH audio streams from Twilio call
      const remoteStream = call.getRemoteStream();
      const localStream = call.getLocalStream();

      console.log('Remote stream:', remoteStream ? 'available' : 'not available');
      console.log('Local stream:', localStream ? 'available' : 'not available');

      if (!remoteStream && !localStream) {
        console.error("No audio streams available from call");
        setStatus("Could not access call audio - streams not ready");
        return;
      }

      // Create an audio context to mix both streams
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();

      if (remoteStream) {
        const remoteSource = audioContext.createMediaStreamSource(remoteStream);
        remoteSource.connect(destination);
        console.log("Remote audio (caller) added");
      }

      if (localStream) {
        const localSource = audioContext.createMediaStreamSource(localStream);
        localSource.connect(destination);
        console.log("Local audio (agent) added");
      }

      const mixedStream = destination.stream;
      const audioTrack = mixedStream.getAudioTracks()[0];

      if (audioTrack) {
        pc.addTrack(audioTrack, mixedStream);
        console.log("Mixed audio stream added to peer connection");
      } else {
        console.error("No audio track in mixed stream");
        setStatus("Failed to create mixed audio");
        return;
      }

      const dc = pc.createDataChannel("oai-events");
      dataChannel.current = dc;
      console.log("Data channel created, state:", dc.readyState);

      dc.onopen = () => {
        console.log("DATA CHANNEL OPENED!");
        setStatus("Transcribing call...");

        const sessionConfig = {
          type: "session.update",
          session: {
            type: "transcription",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: 24000 },
                transcription: {
                  model: "whisper-1",
                  language: "en",
                },
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.2,
                  prefix_padding_ms: 500,
                  silence_duration_ms: 1000,
                },
              },
            },
          },
        };

        console.log("Sending config");
        dc.send(JSON.stringify(sessionConfig));
        console.log("Config sent!");
      };

      dc.onclose = () => {
        console.log("Data channel CLOSED");
      };

      dc.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "conversation.item.input_audio_transcription.delta") {
            setInterimTranscript((prev) => prev + message.delta);
          }

          if (message.type === "conversation.item.input_audio_transcription.completed") {
            const newTranscript: TranscriptItem = {
              id: message.item_id,
              text: message.transcript,
              isFinal: true,
              timestamp: Date.now(),
            };
            setTranscripts((prev) => [...prev, newTranscript]);
            setInterimTranscript("");
          }

          if (message.type === "error") {
            console.error("ERROR:", message);
            setStatus(`Error: ${message.error?.message || "Unknown error"}`);
          }
        } catch (error) {
          console.error("Parse error:", error);
        }
      };

      dc.onerror = (error) => {
        console.error("DC ERROR:", error);
        setStatus("Data channel error");
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log("Offer created");

      setStatus("Connecting to OpenAI...");
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        const err = await sdpResponse.text();
        console.error("API error:", err);
        setStatus("API error");
        return;
      }

      const answer = {
        type: "answer" as RTCSdpType,
        sdp: await sdpResponse.text(),
      };

      await pc.setRemoteDescription(answer);
      console.log("Remote description set");

      setStatus("Connected - transcribing call...");
    } catch (error) {
      console.error("Setup failed:", error);
      setStatus("Error during setup");
    }
  }, [setStatus]);

  const stopTranscription = useCallback(async () => {
    if (sessionStartTime.current && logId.current) {
      const durationSeconds = (Date.now() - sessionStartTime.current) / 1000;
      console.log(`Ended - Duration: ${durationSeconds.toFixed(2)}s`);

      try {
        const costResponse = await fetch('/api/openai/update-cost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            logId: logId.current,
            durationSeconds: durationSeconds
          })
        });

        if (costResponse.ok) {
          const costData = await costResponse.json();
          console.log(`Cost: $${costData.cost}`);
        }
      } catch (error) {
        console.error('Cost error:', error);
      }

      sessionStartTime.current = null;
      logId.current = null;
    }

    dataChannel.current?.close();
    peerConnection.current?.close();
    if (audioElement.current) audioElement.current.srcObject = null;
    setInterimTranscript("");
  }, []);

  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
    setInterimTranscript("");
  }, []);

  const addTranscript = useCallback((transcript: TranscriptItem) => {
    setTranscripts((prev) => [...prev, transcript]);
  }, []);

  return {
    transcripts,
    interimTranscript,
    startTranscription,
    stopTranscription,
    clearTranscripts,
    addTranscript,
  };
}
