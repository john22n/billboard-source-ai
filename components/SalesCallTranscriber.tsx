"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { DollarSign } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBillboardFormExtraction, type BillboardFormData } from "@/hooks/useBillboardFormExtraction";

interface TranscriptItem {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export default function SalesCallTranscriber() {
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sessionStartTime = useRef<number | null>(null);
  const logId = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // Billboard RAG state
  const [billboardContext, setBillboardContext] = useState<string>("");
  const [isLoadingBillboard, setIsLoadingBillboard] = useState(false);
  const lastFetchedTranscript = useRef<string>("");

  // Billboard form extraction hook (using AI SDK)
  const {
    formData: aiFormData,
    isExtracting,
    extractFields,
    error: extractionError,
    overallConfidence,
    clearError,
    reset: resetExtraction,
    cleanup,
    canRetry,
  } = useBillboardFormExtraction();

  // Local state for manual user edits (overrides AI suggestions)
  const [manualEdits, setManualEdits] = useState<Partial<BillboardFormData>>({});

  // Merge AI data with manual edits (manual edits take precedence)
  const formData = {
    leadType: manualEdits.leadType ?? aiFormData?.leadType ?? null,
    name: manualEdits.name ?? aiFormData?.name ?? "",
    phone: manualEdits.phone ?? aiFormData?.phone ?? "",
    email: manualEdits.email ?? aiFormData?.email ?? "",
    website: manualEdits.website ?? aiFormData?.website ?? "",
    advertiser: manualEdits.advertiser ?? aiFormData?.advertiser ?? "",
    hasMediaExperience: manualEdits.hasMediaExperience ?? aiFormData?.hasMediaExperience ?? null,
    hasDoneBillboards: manualEdits.hasDoneBillboards ?? aiFormData?.hasDoneBillboards ?? null,
    businessDescription: manualEdits.businessDescription ?? aiFormData?.businessDescription ?? "",
    yearsInBusiness: manualEdits.yearsInBusiness ?? aiFormData?.yearsInBusiness ?? "",
    billboardPurpose: manualEdits.billboardPurpose ?? aiFormData?.billboardPurpose ?? "",
    targetCityAndState: manualEdits.targetCityAndState ?? aiFormData?.targetCityAndState ?? "",
    targetArea: manualEdits.targetArea ?? aiFormData?.targetArea ?? "",
    startMonth: manualEdits.startMonth ?? aiFormData?.startMonth ?? "",
    campaignLength: manualEdits.campaignLength ?? aiFormData?.campaignLength ?? null,
    decisionMaker: manualEdits.decisionMaker ?? aiFormData?.decisionMaker ?? null,
    notes: manualEdits.notes ?? aiFormData?.notes ?? "",
  };

  // Handle manual field updates
  const updateField = (field: string, value: string | boolean | null) => {
    setManualEdits(prev => ({ ...prev, [field]: value }));
  };

  // Clear both AI and manual data
  const clearForm = () => {
    setManualEdits({});
    resetExtraction();
  };

  // Clear everything: transcripts and form
  const clearAll = () => {
    setTranscripts([]);
    setInterimTranscript("");
    setBillboardContext("");
    lastFetchedTranscript.current = "";
    clearForm();
  };

  // Memoize full transcript to prevent unnecessary re-renders
  const fullTranscript = useMemo(() => {
    return transcripts.map(t => t.text).join(" ");
  }, [transcripts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, interimTranscript]);

  // Extract form fields when transcripts are updated
  useEffect(() => {
    if (fullTranscript.length > 50 && !isExtracting) {
      extractFields(fullTranscript);
    }
  }, [fullTranscript, extractFields, isExtracting]);

  // Fetch billboard pricing data when transcript updates
  
  useEffect(() => {
    const fetchBillboardData = async () => {
      // Key change: Check if transcript has MEANINGFULLY changed (more than 50 characters)
      const transcriptDiff = fullTranscript.length - lastFetchedTranscript.current.length;
    
    if (
      fullTranscript.length > 100 && 
      !isLoadingBillboard && 
      (transcriptDiff > 50 || lastFetchedTranscript.current === '') // Re-fetch if significant change
    ) {
      setIsLoadingBillboard(true);
      lastFetchedTranscript.current = fullTranscript;
      
      try {
        const response = await fetch('/api/billboard-pricing', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ transcript: fullTranscript }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.context) {
            setBillboardContext(data.context);
          }
        } else {
          console.error('Failed to fetch billboard data:', response.statusText);
        }
      } catch (error) {
        console.error("Error fetching billboard data:", error);
      } finally {
        setIsLoadingBillboard(false);
      }
    }
  };

  // Reduced debounce time for more responsive updates
  const timeoutId = setTimeout(fetchBillboardData, 1500);
  
  return () => clearTimeout(timeoutId);
}, [fullTranscript, isLoadingBillboard]);

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

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log("📝 Offer created");

      setStatus("Connecting to OpenAI Realtime API...");
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

    dataChannel.current?.close();
    peerConnection.current?.close();
    if (audioElement.current) audioElement.current.srcObject = null;

    setIsActive(false);
    setStatus("Stopped");
    setInterimTranscript("");
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const selectedFile = files[0];
    setIsUploading(true);
    setStatus("Uploading and transcribing...");

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch("/api/transcribe-file", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (result.text) {
        const newTranscript: TranscriptItem = {
          id: `file-${Date.now()}`,
          text: result.text,
          isFinal: true,
          timestamp: Date.now(),
        };
        setTranscripts((prev) => [...prev, newTranscript]);
        setStatus("File transcribed successfully");
      } else {
        setStatus("Transcription failed");
      }
    } catch (error) {
      console.error("File transcription error:", error);
      setStatus("Error transcribing file");
    } finally {
      setIsUploading(false);
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleRetryExtraction = () => {
    clearError();
    if (fullTranscript.length > 50) {
      extractFields(fullTranscript);
    }
  };

  return (
    <div className="min-h-svh bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-3 lg:p-6">
      <div className="max-w-[1800px] mx-auto">
        <Card className="shadow-2xl border-0 overflow-hidden">
          {/* Compact Header */}
          <CardHeader className="bg-gradient-to-r from-blue-600 via-indigo-600 to-primary text-white py-3 px-4">
            <div className="flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle className="text-xl font-bold tracking-tight">Billboard Lead Form</CardTitle>
                  <p className="text-blue-100 text-xs mt-0.5">Real-time transcription & AI-powered data extraction</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className={`px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center gap-2 text-xs ${
                    (isUploading || isExtracting || status.includes("Fetching") || status.includes("Connecting") || status.includes("Starting") || status.includes("Uploading"))
                      ? "animate-pulse"
                      : ""
                  }`}>
                    {(isUploading || isExtracting || status.includes("Fetching") || status.includes("Connecting") || status.includes("Starting") || status.includes("Uploading")) && (
                      <span className="flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                    )}
                    <span className="font-medium">{status}</span>
                  </div>
                  <div className="flex gap-2">
                    {!isActive ? (
                      <Button
                        onClick={startTranscription}
                        size="sm"
                        className="bg-green-500 hover:bg-green-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 h-8 text-xs"
                      >
                        <span className="mr-1.5">🎤</span> Start Live
                      </Button>
                    ) : (
                      <Button
                        onClick={stopTranscription}
                        size="sm"
                        className="bg-red-500 hover:bg-red-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 h-8 text-xs"
                      >
                        <span className="mr-1.5">⏹</span> Stop
                      </Button>
                    )}
                    <Button
                      onClick={clearAll}
                      size="sm"
                      variant="secondary"
                      className="bg-white/20 hover:bg-white/30 text-white border border-white/30 font-semibold backdrop-blur-sm h-8 text-xs"
                    >
                      Clear All
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*,.mp3,.wav,.m4a,.ogg"
                      onChange={handleFileSelect}
                      disabled={isUploading || isActive}
                      className="hidden"
                    />
                    <Button
                      onClick={handleUploadClick}
                      disabled={isUploading || isActive}
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border border-white/30 font-semibold backdrop-blur-sm h-8 text-xs"
                    >
                      <span className="mr-1.5">📁</span> {isUploading ? "Uploading..." : "Upload"}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Compact Status Indicators */}
              <div className="flex flex-wrap gap-1.5">
                {isExtracting && (
                  <div className="px-2 py-1 bg-blue-500/30 backdrop-blur-sm border border-blue-300/30 rounded text-xs">
                    <span className="text-white font-medium">🤖 Extracting...</span>
                  </div>
                )}
                {isLoadingBillboard && (
                  <div className="px-2 py-1 bg-purple-500/30 backdrop-blur-sm border border-purple-300/30 rounded text-xs">
                    <span className="text-white font-medium">📊 Loading pricing...</span>
                  </div>
                )}
                {billboardContext && !isLoadingBillboard && (
                  <div className="px-2 py-1 bg-green-500/30 backdrop-blur-sm border border-green-300/30 rounded text-xs">
                    <span className="text-white font-medium">✓ Pricing loaded</span>
                  </div>
                )}
                {extractionError && (
                  <div className="flex-1 min-w-full px-2 py-1.5 bg-red-500/30 backdrop-blur-sm border border-red-300/30 rounded">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-white text-xs font-medium">{extractionError}</p>
                      <div className="flex gap-1.5">
                        {canRetry && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={handleRetryExtraction}
                            className="h-6 text-xs px-2"
                          >
                            Retry
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={clearError}
                          className="h-6 text-xs px-2 text-white hover:bg-white/20"
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {overallConfidence > 0 && !isExtracting && !extractionError && (
                  <div className="px-2 py-1 bg-green-500/30 backdrop-blur-sm border border-green-300/30 rounded text-xs">
                    <span className="text-white font-medium">✓ Confidence: {overallConfidence}%</span>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4">
            <Tabs defaultValue="form" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4 bg-slate-100 p-1 rounded-lg h-9">
                <TabsTrigger 
                  value="form" 
                  className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-xs"
                >
                  📋 Lead Form & Pricing
                </TabsTrigger>
                <TabsTrigger 
                  value="transcript"
                  className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-xs"
                >
                  💬 Transcript
                </TabsTrigger>
              </TabsList>

              {/* Form + Pricing Tab - Side by Side */}
              <TabsContent value="form" className="mt-0">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-h-[calc(100vh-240px)] overflow-y-auto pr-2">
                  {/* Lead Form - Left Side (2/3 width) */}
                  <div className="lg:col-span-2 space-y-2.5">
                    {/* Lead Type - More Compact */}
                    <div className="bg-white rounded-lg p-3 shadow-sm border border-slate-200">
                      <Label className="text-slate-700 font-bold text-xs uppercase tracking-wide mb-2 block">
                        Lead Classification
                      </Label>
                      <div className={`grid grid-cols-3 gap-2 ${formData.leadType === null ? 'opacity-60' : ''}`}>
                        {[
                          { value: "tire-kicker", label: "Tire-Kicker", icon: "🔍" },
                          { value: "panel-requestor", label: "Panel-Requestor", icon: "📋" },
                          { value: "availer", label: "Availer", icon: "✅" }
                        ].map((type) => (
                          <label
                            key={type.value}
                            className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                              formData.leadType === type.value
                                ? "border-blue-500 bg-blue-50 shadow-md"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <input
                              type="radio"
                              name="leadType"
                              checked={formData.leadType === type.value}
                              onChange={() => updateField("leadType", type.value)}
                              className="w-4 h-4 text-blue-600"
                            />
                            <span className="text-lg">{type.icon}</span>
                            <span className="font-semibold text-slate-700 text-xs">{type.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Contact Information - Compact */}
                    <div className="bg-white rounded-lg p-3 shadow-sm border border-slate-200">
                      <Label className="text-slate-700 font-bold text-xs uppercase tracking-wide mb-2 block">
                        Contact Information
                      </Label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { field: "name", label: "Full Name", placeholder: "John Doe" },
                          { field: "phone", label: "Phone", placeholder: "(555) 123-4567" },
                          { field: "email", label: "Email", placeholder: "john@example.com" },
                          { field: "website", label: "Website", placeholder: "example.com" }
                        ].map((item) => (
                          <div key={item.field}>
                            <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                              {item.label}
                            </Label>
                            <Input
                              value={formData[item.field as keyof typeof formData] as string ?? ""}
                              onChange={(e) => updateField(item.field, e.target.value)}
                              placeholder={item.placeholder}
                              className={`h-9 text-sm transition-all duration-200 ${
                                !formData[item.field as keyof typeof formData]
                                  ? 'border-slate-300 bg-slate-50 focus:border-orange-400 focus:ring-orange-400'
                                  : 'border-green-500 bg-green-50/30 focus:border-green-600 focus:ring-green-600'
                              }`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Business Details - Compact */}
                    <div className="bg-white rounded-lg p-3 shadow-sm border border-slate-200">
                      <Label className="text-slate-700 font-bold text-xs uppercase tracking-wide mb-2 block">
                        Business Details
                      </Label>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                            Advertiser
                          </Label>
                          <Input
                            value={formData.advertiser ?? ""}
                            onChange={(e) => updateField("advertiser", e.target.value)}
                            placeholder="Company Name"
                            className={`h-9 text-sm ${
                              !formData.advertiser
                                ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                                : 'border-green-500 bg-green-50/30 focus:border-green-600'
                            }`}
                          />
                        </div>
                        <div>
                          <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                            Years in Business
                          </Label>
                          <Input
                            value={formData.yearsInBusiness ?? ""}
                            onChange={(e) => updateField("yearsInBusiness", e.target.value)}
                            placeholder="5 years"
                            className={`h-9 text-sm ${
                              !formData.yearsInBusiness
                                ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                                : 'border-green-500 bg-green-50/30 focus:border-green-600'
                            }`}
                          />
                        </div>
                        <div>
                          <Label className="text-slate-600 font-semibold text-xs mb-1 block">
                            Media Experience?
                          </Label>
                          <div className={`flex gap-2 h-9 items-center px-3 rounded-lg border-2 text-sm ${
                            formData.hasMediaExperience === null
                              ? 'border-slate-300 bg-slate-50'
                              : 'border-green-500 bg-green-50/30'
                          }`}>
                            {[
                              { value: true, label: "Yes" },
                              { value: false, label: "No" }
                            ].map((option) => (
                              <label key={String(option.value)} className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  checked={formData.hasMediaExperience === option.value}
                                  onChange={() => updateField("hasMediaExperience", option.value)}
                                  className="w-3.5 h-3.5 text-blue-600"
                                />
                                <span className="font-semibold text-slate-700 text-xs">{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div>
                          <Label className="text-slate-600 font-semibold text-xs mb-1 block">
                            Done Billboards?
                          </Label>
                          <div className={`flex gap-2 h-9 items-center px-3 rounded-lg border-2 text-sm ${
                            formData.hasDoneBillboards === null
                              ? 'border-slate-300 bg-slate-50'
                              : 'border-green-500 bg-green-50/30'
                          }`}>
                            {[
                              { value: true, label: "Yes" },
                              { value: false, label: "No" }
                            ].map((option) => (
                              <label key={String(option.value)} className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  checked={formData.hasDoneBillboards === option.value}
                                  onChange={() => updateField("hasDoneBillboards", option.value)}
                                  className="w-3.5 h-3.5 text-blue-600"
                                />
                                <span className="font-semibold text-slate-700 text-xs">{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                          Business Description
                        </Label>
                        <Input
                          value={formData.businessDescription ?? ""}
                          onChange={(e) => updateField("businessDescription", e.target.value)}
                          placeholder="What does the business do?"
                          className={`h-9 text-sm ${
                            !formData.businessDescription
                              ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                              : 'border-green-500 bg-green-50/30 focus:border-green-600'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Campaign Details - Compact */}
                    <div className="bg-white rounded-lg p-3 shadow-sm border border-slate-200">
                      <Label className="text-slate-700 font-bold text-xs uppercase tracking-wide mb-2 block">
                        Campaign Details
                      </Label>
                      <div className="grid grid-cols-1 gap-2 mb-2">
                        <div>
                          <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                            <span className="text-sm">🎯</span>Billboard Purpose
                          </Label>
                          <Input
                            value={formData.billboardPurpose ?? ""}
                            onChange={(e) => updateField("billboardPurpose", e.target.value)}
                            placeholder="Brand awareness"
                            className={`h-9 text-sm ${
                              !formData.billboardPurpose
                                ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                                : 'border-green-500 bg-green-50/30 focus:border-green-600'
                            }`}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                              <span className="text-sm">📍</span>Target City & State
                            </Label>
                            <Input
                              value={formData.targetCityAndState ?? ""}
                              onChange={(e) => updateField("targetCityAndState", e.target.value)}
                              placeholder="Austin, TX"
                              className={`h-9 text-sm ${
                                !formData.targetCityAndState
                                  ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                                  : 'border-green-500 bg-green-50/30 focus:border-green-600'
                              }`}
                            />
                          </div>
                          <div>
                            <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                              <span className="text-sm">🛣</span>Target Area
                            </Label>
                            <Input
                              value={formData.targetArea ?? ""}
                              onChange={(e) => updateField("targetArea", e.target.value)}
                              placeholder="I-35 North"
                              className={`h-9 text-sm ${
                                !formData.targetArea
                                  ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                                  : 'border-green-500 bg-green-50/30 focus:border-green-600'
                              }`}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        <div>
                          <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                            <span className="text-sm">📆</span>Campaign Start
                          </Label>
                          <Input
                            value={formData.startMonth ?? ""}
                            onChange={(e) => updateField("startMonth", e.target.value)}
                            placeholder="January 2025"
                            className={`h-9 text-sm ${
                              !formData.startMonth
                                ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                                : 'border-green-500 bg-green-50/30 focus:border-green-600'
                            }`}
                          />
                        </div>
                        <div>
                          <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                            <span className="text-sm">⏱</span>Campaign Length
                          </Label>
                          <div className={`grid grid-cols-6 gap-1.5 p-2 rounded-lg border-2 ${
                            formData.campaignLength === null
                              ? 'border-slate-300 bg-slate-50'
                              : 'border-green-500 bg-green-50/30'
                          }`}>
                            {["1 Mo", "2 Mo", "3 Mo", "6 Mo", "12 Mo", "TBD"].map((length) => (
                              <label
                                key={length}
                                className={`flex items-center justify-center px-2 py-1.5 rounded cursor-pointer transition-all ${
                                  formData.campaignLength === length
                                    ? "bg-blue-500 text-white shadow-md"
                                    : "bg-white border border-slate-200 text-slate-700 hover:border-blue-300"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="campaignLength"
                                  checked={formData.campaignLength === length}
                                  onChange={() => updateField("campaignLength", length)}
                                  className="sr-only"
                                />
                                <span className="text-xs font-semibold">{length}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Decision Maker - Compact */}
                    <div className="bg-white rounded-lg p-3 shadow-sm border border-slate-200">
                      <Label className="text-slate-700 font-bold text-xs uppercase tracking-wide mb-2 block">
                        Decision Making Authority
                      </Label>
                      <div className={`grid grid-cols-2 gap-2 ${
                        formData.decisionMaker === null ? 'opacity-60' : ''
                      }`}>
                        {[
                          { value: "alone", label: "You Alone", icon: "👤" },
                          { value: "partners", label: "Partners", icon: "👥" },
                          { value: "boss", label: "My Boss", icon: "👔" },
                          { value: "committee", label: "Committee", icon: "🏛" }
                        ].map((maker) => (
                          <label
                            key={maker.value}
                            className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                              formData.decisionMaker === maker.value
                                ? "border-blue-500 bg-blue-50 shadow-md"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <input
                              type="radio"
                              name="decisionMaker"
                              checked={formData.decisionMaker === maker.value}
                              onChange={() => updateField("decisionMaker", maker.value)}
                              className="w-4 h-4 text-blue-600"
                            />
                            <span className="text-lg">{maker.icon}</span>
                            <span className="font-semibold text-slate-700 text-xs">{maker.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Notes - Compact */}
                    <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-lg p-3 shadow-sm border-2 border-orange-200">
                      <Label className="text-orange-700 font-bold text-xs uppercase tracking-wide mb-2 flex items-center gap-1">
                        <span className="text-sm">📝</span>What did I tell the person?
                      </Label>
                      <Textarea
                        value={formData.notes ?? ""}
                        onChange={(e) => updateField("notes", e.target.value)}
                        rows={3}
                        placeholder="Conversation notes, promises made, next steps..."
                        className={`text-sm resize-none ${
                          !formData.notes
                            ? 'border-orange-300 bg-white focus:border-orange-500'
                            : 'border-green-500 bg-green-50/30 focus:border-green-600'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Pricing Panel - Right Side (1/3 width) */}
                  <div className="lg:col-span-1">
                    <div className="sticky top-0 bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 border border-slate-200 shadow-inner max-h-[calc(100vh-240px)] flex flex-col">
                      {/* Header - Fixed at top */}
                      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-200 flex-shrink-0">
                        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                          <span className="text-white text-lg"><DollarSign /></span>
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-800 text-sm">Billboard Pricing</h3>
                          <p className="text-xs text-slate-500">Real-time pricing data</p>
                        </div>
                      </div>

                      {/* Scrollable Content Area */}
                      <div className="flex-1 overflow-y-auto pr-2">
                        {isLoadingBillboard && (
                          <div className="flex flex-col items-center justify-center py-12">
                            <div className="relative">
                              <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                            </div>
                            <p className="text-slate-600 font-medium mt-4 text-xs text-center">Loading pricing data...</p>
                          </div>
                        )}

                        {!isLoadingBillboard && billboardContext && (
                          <div className="bg-white rounded-lg p-3 shadow-sm border border-slate-200">
                            <div className="prose prose-sm max-w-none">
                              <pre className="whitespace-pre-wrap font-sans text-slate-700 leading-relaxed text-xs">
                                {billboardContext}
                              </pre>
                            </div>
                          </div>
                        )}

                        {!isLoadingBillboard && !billboardContext && transcripts.length > 0 && (
                          <div className="flex flex-col items-center justify-center py-12 text-center">
                            <div className="text-4xl mb-2">🔍</div>
                            <p className="text-slate-500 font-medium text-xs">No pricing data yet</p>
                            <p className="text-slate-400 text-xs mt-1">
                              Data will appear when locations are mentioned
                            </p>
                          </div>
                        )}

                        {transcripts.length === 0 && (
                          <div className="flex flex-col items-center justify-center py-12 text-center">
                            <div className="text-4xl mb-2">📊</div>
                            <p className="text-slate-400 text-xs font-medium">Pricing data will appear here</p>
                            <p className="text-slate-300 text-xs mt-1">Start a conversation</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Transcript Tab */}
              <TabsContent value="transcript" className="mt-0">
                <div
                  ref={scrollRef}
                  className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 min-h-[400px] max-h-[calc(100vh-240px)] overflow-y-auto border border-slate-200 shadow-inner"
                >
                  {transcripts.map((t, index) => (
                    <div key={t.id} className="mb-2 last:mb-0">
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-xs">
                          {index + 1}
                        </div>
                        <div className="flex-1 bg-white rounded-lg p-3 shadow-sm border border-slate-200">
                          <p className="text-slate-800 leading-relaxed text-sm">{t.text}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {new Date(t.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {interimTranscript && (
                    <div className="mb-2">
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 w-6 h-6 bg-slate-300 rounded-full flex items-center justify-center">
                          <span className="animate-pulse text-white text-xs">•••</span>
                        </div>
                        <div className="flex-1 bg-slate-100 rounded-lg p-3 border border-dashed border-slate-300">
                          <p className="text-slate-600 italic leading-relaxed text-sm">{interimTranscript}</p>
                        </div>
                      </div>
                    </div>
                  )}
                  {transcripts.length === 0 && !interimTranscript && (
                    <div className="flex flex-col items-center justify-center h-full text-center py-16">
                      <div className="text-5xl mb-3">🎤</div>
                      <p className="text-slate-400 text-base font-medium">Transcript will appear here...</p>
                      <p className="text-slate-300 text-sm mt-1">Start recording or upload an audio file</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}