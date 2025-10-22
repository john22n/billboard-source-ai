"use client";
import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TranscriptItem {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export default function RealtimeTranscribe() {
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  
  const sessionStartTime = useRef<number | null>(null);
  const logId = useRef<number | null>(null);
  
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, interimTranscript]);

  const startTranscription = async () => {
    try {
      setStatus("Fetching token...");
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
      console.log(`📊 Session started - Log ID: ${logId.current}`);
      
      setStatus("Starting peer connection...");

      const pc = new RTCPeerConnection();
      peerConnection.current = pc;

      audioElement.current = document.createElement("audio");
      audioElement.current.autoplay = true;
      pc.ontrack = (e) => {
        console.log("🔊 Remote track received");
        audioElement.current!.srcObject = e.streams[0];
      };

      // Add microphone
      if (typeof window !== "undefined" && navigator.mediaDevices?.getUserMedia) {
        try {
          const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
          pc.addTrack(ms.getTracks()[0]);
          console.log("🎤 Microphone track added");
        } catch (err) {
          console.error("Error accessing microphone:", err);
          setStatus("Microphone access denied");
          return;
        }
      } else {
        console.warn("Media devices not available.");
        setStatus("Microphone not available");
        return;
      }

      // ✅ CRITICAL FOR SAFARI: Create data channel BEFORE creating offer
      const dc = pc.createDataChannel("oai-events");
      dataChannel.current = dc;
      
      console.log("📡 Data channel created, state:", dc.readyState);

      dc.onopen = () => {
        console.log("🟢🟢🟢 DATA CHANNEL OPENED! 🟢🟢🟢");
        setStatus("Data channel open - speak now!");
        
        const sessionConfig = {
          type: "session.update",
          session: {
            type: "transcription",
            audio: {
              input: {
                format: {
                  type: "audio/pcm",
                  rate: 24000,
                },
                transcription: {
                  model: "gpt-4o-transcribe",
                  language: "en",
                },
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 500,
                },
              },
            },
          },
        };
        
        console.log("📤 Sending config");
        dc.send(JSON.stringify(sessionConfig));
        console.log("✅ Config sent!");
      };

      dc.onclose = () => {
        console.log("🔴 Data channel CLOSED");
      };

      dc.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("📨 TYPE:", message.type);

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
            console.error("❌ ERROR:", message);
            setStatus(`Error: ${message.error?.message || "Unknown error"}`);
          }
        } catch (error) {
          console.error("Parse error:", error);
        }
      };

      dc.onerror = (error) => {
        console.error("❌ DC ERROR:", error);
        setStatus("Data channel error");
      };

      // Create offer AFTER data channel is set up
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log("📝 Offer created");

      setStatus("Connecting to OpenAI...");
      
      const sdpResponse = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${EPHEMERAL_KEY}`,
            "Content-Type": "application/sdp",
          },
        }
      );

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
      console.log("✅ Remote description set");

      setStatus("Connected — transcribing...");
      setIsActive(true);
    } catch (error) {
      console.error("Setup failed:", error);
      setStatus("Error during setup");
    }
  };

  const stopTranscription = async () => {
    if (sessionStartTime.current && logId.current) {
      const durationSeconds = (Date.now() - sessionStartTime.current) / 1000;
      
      console.log(`📊 Ended - Duration: ${durationSeconds.toFixed(2)}s`);
      
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
          console.log(`✅ Cost: $${costData.cost}`);
        }
      } catch (error) {
        console.error('Cost error:', error);
      }
      
      sessionStartTime.current = null;
      logId.current = null;
    }

    if (dataChannel.current) {
      dataChannel.current.close();
    }
    if (peerConnection.current) {
      peerConnection.current.close();
    }
    if (audioElement.current) {
      audioElement.current.srcObject = null;
    }
    setIsActive(false);
    setStatus("Stopped");
    setInterimTranscript("");
  };

  const clearTranscripts = () => {
    setTranscripts([]);
    setInterimTranscript("");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-2xl shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-semibold">
            🎙️ Realtime Transcription
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{status}</p>
            {isActive && (
              <div className="flex items-center space-x-2">
                <div className="h-3 w-3 animate-pulse rounded-full bg-red-500"></div>
                <span className="text-sm font-medium text-red-500">
                  Recording
                </span>
              </div>
            )}
          </div>

          <div className="flex space-x-4">
            <Button
              onClick={startTranscription}
              disabled={isActive}
              className="flex-1"
            >
              Start
            </Button>
            <Button
              variant="destructive"
              onClick={stopTranscription}
              disabled={!isActive}
              className="flex-1"
            >
              Stop
            </Button>
            <Button
              variant="outline"
              onClick={clearTranscripts}
              disabled={isActive || transcripts.length === 0}
            >
              Clear
            </Button>
          </div>

          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">Transcription:</h3>
            <div className="h-96 overflow-auto rounded-md border bg-white p-4" ref={scrollRef}>
              {transcripts.length === 0 && !interimTranscript && (
                <p className="text-sm text-gray-400 italic">
                  Start transcribing to see text appear here...
                </p>
              )}

              {transcripts.map((transcript) => (
                <div
                  key={transcript.id}
                  className="mb-3 rounded-md bg-blue-50 p-3"
                >
                  <p className="text-sm text-gray-800">{transcript.text}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {new Date(transcript.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              ))}

              {interimTranscript && (
                <div className="mb-3 rounded-md bg-yellow-50 p-3 border-l-4 border-yellow-400">
                  <p className="text-sm text-gray-600 italic">
                    {interimTranscript}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Transcribing...
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="text-xs text-gray-500 mt-2">
            <p>
              💡 <strong>Tip:</strong> Speak clearly. Blue = final, yellow = processing.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}