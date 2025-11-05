"use client";
import { useRef, useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dropzone, DropzoneContent, DropzoneEmptyState } from '@/components/ui/shadcn-io/dropzone';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBillboardFormExtraction } from "@/hooks/useBillboardFormExtraction";

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

  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

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
  const [manualEdits, setManualEdits] = useState<Partial<typeof aiFormData>>({});

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
    targetCity: manualEdits.targetCity ?? aiFormData?.targetCity ?? "",
    targetArea: manualEdits.targetArea ?? aiFormData?.targetArea ?? "",
    startMonth: manualEdits.startMonth ?? aiFormData?.startMonth ?? "",
    campaignLength: manualEdits.campaignLength ?? aiFormData?.campaignLength ?? null,
    budgetRange: manualEdits.budgetRange ?? aiFormData?.budgetRange ?? null,
    decisionMaker: manualEdits.decisionMaker ?? aiFormData?.decisionMaker ?? null,
    notes: manualEdits.notes ?? aiFormData?.notes ?? "",
  };

  // Handle manual field updates
  const updateField = (field: string, value: any) => {
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
  // Use memoized transcript to prevent infinite loops
  useEffect(() => {
    if (fullTranscript.length > 50 && !isExtracting) {
      extractFields(fullTranscript);
    }
  }, [fullTranscript]); // Only depend on the memoized transcript, not extractFields

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
      setStatus("Starting peer connection...");

      const pc = new RTCPeerConnection();
      peerConnection.current = pc;

      audioElement.current = document.createElement("audio");
      audioElement.current.autoplay = true;
      pc.ontrack = (e) => {
        audioElement.current!.srcObject = e.streams[0];
      };

      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      pc.addTrack(ms.getTracks()[0]);

      const dc = pc.createDataChannel("oai-events");
      dataChannel.current = dc;

      dc.onopen = () => {
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
        dc.send(JSON.stringify(sessionConfig));
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
            setStatus(`Error: ${message.error?.message || "Unknown error"}`);
          }
        } catch (error) {
          console.error("Error parsing message:", error);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

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
        console.error("Realtime API error:", err);
        setStatus("Realtime API error");
        return;
      }

      const answer = {
        type: "answer" as RTCSdpType,
        sdp: await sdpResponse.text(),
      };
      await pc.setRemoteDescription(answer);

      setStatus("Connected — transcribing...");
      setIsActive(true);
    } catch (error) {
      console.error("Transcription setup failed:", error);
      setStatus("Error during setup");
    }
  };

  const stopTranscription = () => {
    dataChannel.current?.close();
    peerConnection.current?.close();
    if (audioElement.current) audioElement.current.srcObject = null;
    setIsActive(false);
    setStatus("Session stopped");
    setInterimTranscript("");
  };

  const handleFileDrop = async (acceptedFiles: File[]) => {
    if (!acceptedFiles || acceptedFiles.length === 0) return;

    const droppedFile = acceptedFiles[0];
    setFile(droppedFile);
    setIsUploading(true);
    setStatus("Uploading and transcribing...");

    const formData = new FormData();
    formData.append("file", droppedFile);

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
    }
  };

  const handleRetryExtraction = () => {
    clearError();
    if (fullTranscript.length > 50) {
      extractFields(fullTranscript);
    }
  };

  return (
    <div className="h-full bg-gradient-to-br from-gray-50 to-gray-100 p-4 lg:p-6 flex flex-col overflow-hidden">
      <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col overflow-hidden">
        <Card className="shadow-lg flex flex-col flex-1 overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-blue-500 to-orange-500 text-white py-3 px-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <CardTitle className="text-lg lg:text-xl">Billboard Lead Form</CardTitle>

                <div className="flex items-center gap-2">
                  <span className={`text-xs bg-white/20 px-3 py-1 rounded-full flex items-center gap-2 ${
                    (isUploading || isExtracting || status.includes("Fetching") || status.includes("Connecting") || status.includes("Starting") || status.includes("Uploading"))
                      ? "animate-pulse"
                      : ""
                  }`}>
                    {(isUploading || isExtracting || status.includes("Fetching") || status.includes("Connecting") || status.includes("Starting") || status.includes("Uploading")) && (
                      <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-ping"></span>
                    )}
                    {status}
                  </span>

                  <div className="flex gap-2">
                    {!isActive ? (
                      <Button
                        onClick={startTranscription}
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-xs h-7"
                      >
                        Start Live
                      </Button>
                    ) : (
                      <Button
                        onClick={stopTranscription}
                        size="sm"
                        className="bg-red-600 hover:bg-red-700 text-xs h-7"
                      >
                        Stop
                      </Button>
                    )}
                    <Button
                      onClick={clearAll}
                      size="sm"
                      variant="secondary"
                      className="text-xs h-7"
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              </div>

              {/* Dropzone moved here */}
              <Dropzone
                onDrop={handleFileDrop}
                accept={{
                  'audio/*': ['.mp3', '.wav', '.m4a', '.ogg'],
                }}
                maxFiles={1}
                disabled={isUploading || isActive}
                className="py-2 px-3"
              >
                <DropzoneEmptyState />
                <DropzoneContent />
              </Dropzone>
            </div>

            {/* Status Messages - Compact */}
            {isExtracting && (
              <div className="mt-2 bg-blue-500/30 border border-white/30 rounded px-2 py-1">
                <p className="text-white text-xs">🤖 AI extracting fields...</p>
              </div>
            )}

            {extractionError && (
              <div className="mt-2 bg-red-500/30 border border-white/30 rounded px-2 py-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-white text-xs">{extractionError}</p>
                  <div className="flex gap-1">
                    {canRetry && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleRetryExtraction}
                        className="h-5 text-xs px-2"
                      >
                        Retry
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearError}
                      className="h-5 text-xs px-2 text-white hover:bg-white/20"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {overallConfidence > 0 && !isExtracting && !extractionError && (
              <div className="mt-2 bg-green-500/30 border border-white/30 rounded px-2 py-1">
                <p className="text-white text-xs">✓ Confidence: {overallConfidence}%</p>
              </div>
            )}
          </CardHeader>

          <CardContent className="p-4 flex-1 flex flex-col overflow-hidden">
            <Tabs defaultValue="form" className="w-full h-full flex flex-col">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="form" className="text-sm">Lead Form</TabsTrigger>
                <TabsTrigger value="transcript" className="text-sm">Transcript</TabsTrigger>
              </TabsList>

              {/* Form Tab */}
              <TabsContent value="form" className="mt-0 flex-1 overflow-y-auto">
                <div className="space-y-3 pb-4">
                  {/* Lead Type */}
                  <div>
                    <Label className="text-gray-700 font-semibold text-sm">LEAD TYPE:</Label>
                    <div className="flex gap-3 mt-1">
                      <Label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="leadType"
                          checked={formData.leadType === "tire-kicker"}
                          onChange={() => updateField("leadType", "tire-kicker")}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-xs">Tire-Kicker</span>
                      </Label>
                      <Label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="leadType"
                          checked={formData.leadType === "panel-requestor"}
                          onChange={() => updateField("leadType", "panel-requestor")}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-xs">Panel-Requestor</span>
                      </Label>
                      <Label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="leadType"
                          checked={formData.leadType === "availer"}
                          onChange={() => updateField("leadType", "availer")}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-xs">Availer</span>
                      </Label>
                    </div>
                  </div>

                  {/* Contact Info - 4 columns on larger screens */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-gray-700 font-semibold text-xs">NAME:</Label>
                      <Input
                        value={formData.name ?? ""}
                        onChange={(e) => updateField("name", e.target.value)}
                        className="mt-0.5 border-orange-200 focus:border-orange-400 h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-700 font-semibold text-xs">PHONE:</Label>
                      <Input
                        value={formData.phone ?? ""}
                        onChange={(e) => updateField("phone", e.target.value)}
                        className="mt-0.5 border-orange-200 focus:border-orange-400 h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-700 font-semibold text-xs">EMAIL:</Label>
                      <Input
                        value={formData.email ?? ""}
                        onChange={(e) => updateField("email", e.target.value)}
                        className="mt-0.5 border-orange-200 focus:border-orange-400 h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-700 font-semibold text-xs">WEBSITE:</Label>
                      <Input
                        value={formData.website ?? ""}
                        onChange={(e) => updateField("website", e.target.value)}
                        className="mt-0.5 border-orange-200 focus:border-orange-400 h-8 text-sm"
                      />
                    </div>
                  </div>

                  {/* Advertiser */}
                  <div>
                    <Label className="text-gray-700 font-semibold text-xs">ADVERTISER:</Label>
                    <Input
                      value={formData.advertiser ?? ""}
                      onChange={(e) => updateField("advertiser", e.target.value)}
                      className="mt-0.5 border-orange-200 focus:border-orange-400 h-8 text-sm"
                    />
                  </div>

                  {/* Media Experience & Billboard Experience - in one row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-gray-700 font-semibold text-xs">MEDIA EXP?</Label>
                      <div className="flex gap-3 mt-1">
                        <Label className="flex items-center gap-1">
                          <input
                            type="radio"
                            checked={formData.hasMediaExperience === true}
                            onChange={() => updateField("hasMediaExperience", true)}
                            className="h-3 w-3"
                          />
                          <span className="text-xs">Y</span>
                        </Label>
                        <Label className="flex items-center gap-1">
                          <input
                            type="radio"
                            checked={formData.hasMediaExperience === false}
                            onChange={() => updateField("hasMediaExperience", false)}
                            className="h-3 w-3"
                          />
                          <span className="text-xs">N</span>
                        </Label>
                      </div>
                    </div>
                    <div>
                      <Label className="text-gray-700 font-semibold text-xs">BILLBOARDS?</Label>
                      <div className="flex gap-3 mt-1">
                        <Label className="flex items-center gap-1">
                          <input
                            type="radio"
                            checked={formData.hasDoneBillboards === true}
                            onChange={() => updateField("hasDoneBillboards", true)}
                            className="h-3 w-3"
                          />
                          <span className="text-xs">Y</span>
                        </Label>
                        <Label className="flex items-center gap-1">
                          <input
                            type="radio"
                            checked={formData.hasDoneBillboards === false}
                            onChange={() => updateField("hasDoneBillboards", false)}
                            className="h-3 w-3"
                          />
                          <span className="text-xs">N</span>
                        </Label>
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-gray-700 font-semibold text-xs">YEARS IN BUSINESS:</Label>
                      <Input
                        value={formData.yearsInBusiness?? ""}
                        onChange={(e) => updateField("yearsInBusiness", e.target.value)}
                        className="mt-0.5 border-orange-200 focus:border-orange-400 h-8 text-sm"
                      />
                    </div>
                  </div>

                  {/* Business Description */}
                  <div>
                    <Label className="text-gray-700 font-semibold text-xs">WHAT DOES THE BUSINESS DO?</Label>
                    <Input
                      value={formData.businessDescription ?? ""}
                      onChange={(e) => updateField("businessDescription", e.target.value)}
                      className="mt-0.5 border-orange-200 focus:border-orange-400 h-8 text-sm"
                    />
                  </div>

                  {/* Billboard Purpose, Target City, Target Area */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-gray-700 font-semibold text-xs">BILLBOARD FOR:</Label>
                      <Input
                        value={formData.billboardPurpose ?? ""}
                        onChange={(e) => updateField("billboardPurpose", e.target.value)}
                        className="mt-0.5 border-orange-200 focus:border-orange-400 h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-700 font-semibold text-xs">TARGET CITY:</Label>
                      <Input
                        value={formData.targetCity ?? ""}
                        onChange={(e) => updateField("targetCity", e.target.value)}
                        className="mt-0.5 border-orange-200 focus:border-orange-400 h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-700 font-semibold text-xs">TARGET AREA (HWY/ST):</Label>
                      <Input
                        value={formData.targetArea ?? ""}
                        onChange={(e) => updateField("targetArea", e.target.value)}
                        className="mt-0.5 border-orange-200 focus:border-orange-400 h-8 text-sm"
                      />
                    </div>
                  </div>

                  {/* Start Date & Campaign Length */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-gray-700 font-semibold text-xs">START DATE:</Label>
                      <Input
                        value={formData.startMonth ?? ""}
                        onChange={(e) => updateField("startMonth", e.target.value)}
                        placeholder="e.g., January 2025"
                        className="mt-0.5 border-orange-200 focus:border-orange-400 h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-700 font-semibold text-xs">LENGTH:</Label>
                      <div className="flex gap-2 mt-0.5 flex-wrap">
                        {["1 Mo", "2 Mo", "3 Mo", "6 Mo", "12 Mo", "TBD"].map((length) => (
                          <Label key={length} className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="radio"
                              name="campaignLength"
                              checked={formData.campaignLength === length}
                              onChange={() => updateField("campaignLength", length)}
                              className="h-3 w-3"
                            />
                            <span className="text-xs">{length}</span>
                          </Label>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Budget Range - Compact */}
                  <div>
                    <Label className="text-gray-700 font-semibold text-xs">BUDGET RANGE:</Label>
                    <div className="mt-1 space-y-0.5">
                      <Label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="budgetRange"
                          checked={formData.budgetRange === "small"}
                          onChange={() => updateField("budgetRange", "small")}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-xs">SMALL: $750-1,500 (1mo) | $2,250-4,500 (3mo) | $9,000-18,000 (12mo)</span>
                      </Label>
                      <Label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="budgetRange"
                          checked={formData.budgetRange === "midsize"}
                          onChange={() => updateField("budgetRange", "midsize")}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-xs">MIDSIZE: $1,500-3,000 (1mo) | $4,500-9,000 (3mo) | $18,000-36,000 (12mo)</span>
                      </Label>
                      <Label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="budgetRange"
                          checked={formData.budgetRange === "major"}
                          onChange={() => updateField("budgetRange", "major")}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-xs">MAJOR: $3,000-6,000 (1mo) | $9,000-18,000 (3mo) | $36,000-72,000 (12mo)</span>
                      </Label>
                    </div>
                  </div>

                  {/* Decision Maker - Compact */}
                  <div>
                    <Label className="text-gray-700 font-semibold text-xs">DECISION MAKER?</Label>
                    <div className="flex flex-wrap gap-3 mt-1">
                      <Label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="decisionMaker"
                          checked={formData.decisionMaker === "alone"}
                          onChange={() => updateField("decisionMaker", "alone")}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-blue-500 font-semibold text-xs">YOU ALONE</span>
                      </Label>
                      <Label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="decisionMaker"
                          checked={formData.decisionMaker === "partners"}
                          onChange={() => updateField("decisionMaker", "partners")}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-blue-500 font-semibold text-xs">TALK W/PARTNERS</span>
                      </Label>
                      <Label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="decisionMaker"
                          checked={formData.decisionMaker === "boss"}
                          onChange={() => updateField("decisionMaker", "boss")}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-blue-500 font-semibold text-xs">MY BOSS</span>
                      </Label>
                      <Label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="decisionMaker"
                          checked={formData.decisionMaker === "committee"}
                          onChange={() => updateField("decisionMaker", "committee")}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-blue-500 font-semibold text-xs">COMMITTEE</span>
                      </Label>
                    </div>
                  </div>

                  {/* Notes - Compact */}
                  <div>
                    <Label className="text-orange-500 font-semibold text-sm">WHAT DID I TELL THE PERSON?</Label>
                    <Textarea
                      value={formData.notes ?? ""}
                      onChange={(e) => updateField("notes", e.target.value)}
                      rows={3}
                      className="mt-1 border-orange-200 focus:border-orange-400 text-sm"
                      placeholder="Notes from the conversation..."
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Transcript Tab */}
              <TabsContent value="transcript" className="mt-0 flex-1 flex flex-col overflow-hidden">
                <div
                  ref={scrollRef}
                  className="bg-gray-50 rounded-lg p-3 flex-1 overflow-y-auto border border-gray-200 space-y-2"
                >
                  {transcripts.map((t) => (
                    <div
                      key={t.id}
                      className="text-gray-800 bg-white p-2.5 rounded shadow-sm text-sm"
                    >
                      {t.text}
                    </div>
                  ))}
                  {interimTranscript && (
                    <div className="text-gray-400 italic p-2.5 text-sm">{interimTranscript}</div>
                  )}
                  {transcripts.length === 0 && !interimTranscript && (
                    <p className="text-gray-400 text-center mt-20 text-sm">
                      Transcript will appear here...
                    </p>
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
