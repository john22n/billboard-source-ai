"use client";

import { useRef, useState, useCallback } from "react";
import { Call } from '@twilio/voice-sdk';
import type { TranscriptItem } from "@/types/sales-call";

interface UseOpenAITranscriptionOptions {
  onStatusChange?: (status: string) => void;
}

interface TranscriptionSession {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  speaker: 'agent' | 'caller';
}

export function useOpenAITranscription(options: UseOpenAITranscriptionOptions = {}) {
  const sessions = useRef<TranscriptionSession[]>([]);
  const sessionStartTime = useRef<number | null>(null);
  const logId = useRef<number | null>(null);

  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [interimSpeaker, setInterimSpeaker] = useState<'agent' | 'caller' | null>(null);

  const setStatus = useCallback((status: string) => {
    options.onStatusChange?.(status);
  }, [options]);

  const createTranscriptionSession = async (
    stream: MediaStream,
    speaker: 'agent' | 'caller',
    ephemeralKey: string
  ): Promise<TranscriptionSession | null> => {
    try {
      const pc = new RTCPeerConnection();
      const audioTrack = stream.getAudioTracks()[0];

      if (!audioTrack) {
        console.error(`No audio track for ${speaker}`);
        return null;
      }

      pc.addTrack(audioTrack, stream);
      console.log(`Added ${speaker} audio track`);

      const dc = pc.createDataChannel("oai-events");

      dc.onopen = () => {
        console.log(`${speaker} data channel opened`);

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
                  threshold: 0.3,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 800,
                },
              },
            },
          },
        };

        dc.send(JSON.stringify(sessionConfig));
      };

      dc.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "conversation.item.input_audio_transcription.delta") {
            setInterimTranscript((prev) => prev + message.delta);
            setInterimSpeaker(speaker);
          }

          if (message.type === "conversation.item.input_audio_transcription.completed") {
            const newTranscript: TranscriptItem = {
              id: message.item_id,
              text: message.transcript,
              isFinal: true,
              timestamp: Date.now(),
              speaker,
            };
            setTranscripts((prev) => [...prev, newTranscript]);
            setInterimTranscript("");
            setInterimSpeaker(null);
          }

          if (message.type === "error") {
            console.error(`${speaker} error:`, message);
          }
        } catch (error) {
          console.error("Parse error:", error);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        console.error(`${speaker} API error:`, await sdpResponse.text());
        return null;
      }

      const answer = {
        type: "answer" as RTCSdpType,
        sdp: await sdpResponse.text(),
      };

      await pc.setRemoteDescription(answer);
      console.log(`${speaker} session connected`);

      return { pc, dc, speaker };
    } catch (error) {
      console.error(`${speaker} session failed:`, error);
      return null;
    }
  };

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

      setStatus("Connecting transcription...");

      const remoteStream = call.getRemoteStream();
      const localStream = call.getLocalStream();

      console.log('Remote stream (caller):', remoteStream ? 'available' : 'not available');
      console.log('Local stream (agent):', localStream ? 'available' : 'not available');

      const newSessions: TranscriptionSession[] = [];

      // Create separate session for caller audio
      if (remoteStream) {
        const callerSession = await createTranscriptionSession(remoteStream, 'caller', EPHEMERAL_KEY);
        if (callerSession) newSessions.push(callerSession);
      }

      // Create separate session for agent audio
      if (localStream) {
        // Need a second token for agent stream
        const agentTokenResponse = await fetch("/api/token");
        const agentData = await agentTokenResponse.json();
        
        if (agentData?.value) {
          const agentSession = await createTranscriptionSession(localStream, 'agent', agentData.value);
          if (agentSession) newSessions.push(agentSession);
        }
      }

      sessions.current = newSessions;

      if (newSessions.length > 0) {
        setStatus("Transcribing call...");
      } else {
        setStatus("Could not start transcription");
      }
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

    // Close all sessions
    sessions.current.forEach(session => {
      session.dc?.close();
      session.pc.close();
    });
    sessions.current = [];
    
    setInterimTranscript("");
    setInterimSpeaker(null);
  }, []);

  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
    setInterimTranscript("");
    setInterimSpeaker(null);
  }, []);

  const addTranscript = useCallback((transcript: TranscriptItem) => {
    setTranscripts((prev) => [...prev, transcript]);
  }, []);

  return {
    transcripts,
    interimTranscript,
    interimSpeaker,
    startTranscription,
    stopTranscription,
    clearTranscripts,
    addTranscript,
  };
}
