"use client";

import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBillboardFormExtraction } from "@/hooks/useBillboardFormExtraction";
import { useTwilioContext } from "@/components/providers/TwilioProvider";
import { useOpenAITranscription } from "@/hooks/useOpenAITranscription";
import { LeadForm, PricingPanel, TranscriptView } from "@/components/sales-call";
import type { TranscriptItem } from "@/types/sales-call";
import { showSuccessToast, showErrorToast } from "@/lib/error-handling";
import { useFormStore } from "@/stores/formStore";

// Dynamic imports for heavy map components
const GoogleMapPanel = dynamic(
  () => import("@/components/sales-call/GoogleMapPanel").then(mod => mod.GoogleMapPanel),
  { ssr: false, loading: () => <div className="h-full flex items-center justify-center text-gray-500">Loading Google Maps...</div> }
);

const ArcGISMapPanel = dynamic(
  () => import("@/components/sales-call/ArcGISMapPanel").then(mod => mod.ArcGISMapPanel),
  { ssr: false, loading: () => <div className="h-full flex items-center justify-center text-gray-500">Loading ArcGIS Map...</div> }
);

export default function SalesCallTranscriber() {
  // 🔍 Performance monitoring (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log('🔄 Re-render: SalesCallTranscriber');
  }

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [billboardContext, setBillboardContext] = useState<string>("");
  const [isLoadingBillboard, setIsLoadingBillboard] = useState(false);
  const [isSubmittingNutshell, setIsSubmittingNutshell] = useState(false);
  const [nutshellStatus, setNutshellStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [nutshellMessage, setNutshellMessage] = useState('');
  const [resetTrigger, setResetTrigger] = useState(0);
  
  // ✅ Store caller's phone number separately so it persists after call is accepted
  const [callerPhone, setCallerPhone] = useState<string>("");

  // ✅ Get store actions (STABLE - won't cause re-renders)
  const updateFromAI = useFormStore((s) => s.updateFromAI);
  const resetForm = useFormStore((s) => s.reset);
  const getFormData = useFormStore((s) => s.getFormData);

  // ✅ Subscribe to minimal state for maps/pricing
  const activeMarketIndex = useFormStore((s) => s.activeMarketIndex);
  const additionalMarkets = useFormStore((s) => s.additionalMarkets);
  const targetCity = useFormStore((s) => s.fields.targetCity);
  const state = useFormStore((s) => s.fields.state);
  const targetArea = useFormStore((s) => s.fields.targetArea);

  // Custom hooks for Twilio and transcription
  const {
    transcripts,
    interimTranscript,
    interimSpeaker,
    startTranscription,
    stopTranscription,
    clearTranscripts,
    addTranscript,
  } = useOpenAITranscription({
    onStatusChange: (newStatus) => updateStatus(newStatus),
  });

  const {
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
    onCallAccepted,
    onCallDisconnected,
  } = useTwilioContext();

  // ✅ Capture caller's phone number as soon as incoming call arrives
  useEffect(() => {
    if (incomingCall?.parameters?.From) {
      const fromNumber = incomingCall.parameters.From;
      console.log('📞 Captured caller phone from Twilio:', fromNumber);
      setCallerPhone(fromNumber);
    }
  }, [incomingCall]);

  // Register callbacks for call events
  useEffect(() => {
    onCallAccepted((call) => startTranscription(call));
    onCallDisconnected(() => {
      stopTranscription();
      resetStatus();
    });
  }, [onCallAccepted, onCallDisconnected, startTranscription, stopTranscription, resetStatus]);

  // Billboard form extraction hook (must be declared before effects that use extractFields)
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
    extractionCount,
  } = useBillboardFormExtraction();

  // ✅ Push AI data to Zustand store when extraction completes
  useEffect(() => {
    if (aiFormData) {
      console.log("🎯 Applying extracted data to form:", aiFormData);
      updateFromAI(aiFormData);
    }
  }, [aiFormData, extractionCount, updateFromAI]);

  // ✅ Track if we've done the final extraction for this call
  const hasDoneFinalExtractionRef = useRef<boolean>(false);
  const fullTranscriptRef = useRef<string>("");
  
  // Keep the ref updated with latest transcript (declared after fullTranscript is defined)
  const fullTranscript = useMemo(() => {
    return transcripts.map(t => {
      const speaker = t.speaker === 'agent' ? 'Sales Rep' : 'Caller';
      return `${speaker}: ${t.text}`;
    }).join("\n");
  }, [transcripts]);

  useEffect(() => {
    fullTranscriptRef.current = fullTranscript;
  }, [fullTranscript]);
  
  // ✅ Reset the flag when a new call starts
  useEffect(() => {
    if (callActive) {
      hasDoneFinalExtractionRef.current = false;
    }
  }, [callActive]);
  
  // ✅ Do ONE final extraction when call ends
  useEffect(() => {
    if (!callActive && !hasDoneFinalExtractionRef.current && fullTranscriptRef.current.length > 50) {
      hasDoneFinalExtractionRef.current = true;
      console.log("📞 Call ended - running final extraction");
      extractFields(fullTranscriptRef.current);
    }
  }, [callActive, extractFields]);

  const clearAll = useCallback(() => {
    clearTranscripts();
    setBillboardContext("");
    resetExtraction();
    resetForm();
    setCallerPhone("");
    setResetTrigger(prev => prev + 1);
  }, [clearTranscripts, resetExtraction, resetForm]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Auto-scroll transcripts
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, interimTranscript]);

  // Extract form fields when transcripts update (only during active call)
  useEffect(() => {
    if (fullTranscript.length > 50 && !isExtracting && callActive) {
      extractFields(fullTranscript);
    }
  }, [fullTranscript, extractFields, isExtracting, callActive]);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const selectedFile = files[0];
    setIsUploading(true);
    updateStatus("Uploading and transcribing...");

    const formDataUpload = new FormData();
    formDataUpload.append("file", selectedFile);

    try {
      const res = await fetch("/api/transcribe-file", {
        method: "POST",
        body: formDataUpload,
      });

      const result = await res.json();

      if (result.text) {
        const newTranscript: TranscriptItem = {
          id: `file-${Date.now()}`,
          text: result.text,
          isFinal: true,
          timestamp: Date.now(),
        };
        addTranscript(newTranscript);
        updateStatus("File transcribed successfully");
      } else {
        updateStatus("Transcription failed");
      }
    } catch (error) {
      console.error("File transcription error:", error);
      updateStatus("Error transcribing file");
    } finally {
      setIsUploading(false);
      if (event.target) {
        event.target.value = '';
      }
    }
  }, [addTranscript, updateStatus]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRetryExtraction = useCallback(() => {
    clearError();
    if (fullTranscript.length > 50) {
      extractFields(fullTranscript);
    }
  }, [clearError, extractFields, fullTranscript]);

  const handleNutshellSubmit = useCallback(async () => {
    setIsSubmittingNutshell(true);
    setNutshellStatus('idle');
    setNutshellMessage('');

    const formData = getFormData();

    try {
      const response = await fetch('/api/nutshell/create-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name || '',
          phone: formData.phone || '',
          email: formData.email || '',
          position: formData.position || '',
          website: formData.website || '',
          decisionMaker: formData.decisionMaker || '',
          typeName: formData.typeName || '',
          businessName: formData.businessName || '',
          entityName: formData.entityName || '',
          billboardsBeforeYN: formData.billboardsBeforeYN || '',
          billboardsBeforeDetails: formData.billboardsBeforeDetails || '',
          billboardPurpose: formData.billboardPurpose || '',
          accomplishDetails: formData.accomplishDetails || '',
          targetAudience: formData.targetAudience || '',
          targetCity: formData.targetCity || '',
          state: formData.state || '',
          targetArea: formData.targetArea || '',
          startMonth: formData.startMonth || '',
          campaignLength: formData.campaignLength || '',
          boardType: formData.boardType || '',
          hasMediaExperience: formData.hasMediaExperience,
          yearsInBusiness: formData.yearsInBusiness || '',
          leadType: formData.leadType || '',
          notes: formData.notes || '',
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setNutshellStatus('success');
        setNutshellMessage('Lead created');
        showSuccessToast('Lead sent to Nutshell');
      } else {
        setNutshellStatus('error');
        setNutshellMessage(result.error || 'Failed');
        showErrorToast(result.error || 'Failed to create lead');
      }
    } catch (error) {
      console.error('Error submitting to Nutshell:', error);
      setNutshellStatus('error');
      setNutshellMessage('Connection failed');
      showErrorToast('Connection to Nutshell failed');
    } finally {
      setIsSubmittingNutshell(false);
    }
  }, [getFormData]);

  const isProcessing = isUploading || isExtracting ||
    status.includes("Fetching") || status.includes("Connecting") ||
    status.includes("Starting") || status.includes("Uploading") ||
    status.includes("Initializing");

  // ✅ Memoized current market location for maps
  const currentMarketLocation = useMemo(() => {
    if (activeMarketIndex === 0) {
      return targetCity && state
        ? `${targetCity}, ${state}`
        : targetArea || "";
    } else {
      const market = additionalMarkets[activeMarketIndex - 1];
      if (!market) return "";
      return market.targetCity && market.state
        ? `${market.targetCity}, ${market.state}`
        : market.targetArea || "";
    }
  }, [activeMarketIndex, targetCity, state, targetArea, additionalMarkets]);

  return (
    <div className="h-full overflow-hidden flex items-center justify-center m-0 p-0">
      <div className="max-w-[1800px] xl:max-h-[1250px] w-full h-full flex flex-col px-2 sm:px-0">
        <Card className="shadow-lg border-0 flex flex-col h-full overflow-hidden">
          {/* Header */}
          <CardHeader className="bg-gradient-to-r from-blue-600 via-indigo-600 to-primary text-white py-2 sm:py-3 px-3 sm:px-4 flex-shrink-0">
            <div className="flex flex-col gap-2">
              {/* Title Row */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-lg sm:text-xl font-bold tracking-tight truncate">
                    Billboard Lead Form
                    {userEmail && (
                      <span className="text-[10px] sm:text-xs font-normal ml-2 opacity-75 hidden sm:inline">
                        ({userEmail})
                      </span>
                    )}
                  </CardTitle>
                  <p className="text-blue-100 text-[10px] sm:text-xs mt-0.5 hidden sm:block">Real-time transcription & AI-powered data extraction</p>
                </div>
                
                {/* Status and Buttons */}
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  {/* Status Badge */}
                  <div className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs ${isProcessing ? "animate-pulse" : ""}`}>
                    {twilioReady && !callActive && (
                      <span className={`inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full flex-shrink-0 ${
                          status === 'Ready to receive calls' 
                            ? 'bg-green-400 animate-pulse' 
                            : 'bg-red-400'
                        }`}></span>
                    )}
                    {callActive && (
                      <span className="inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 bg-red-400 rounded-full animate-pulse flex-shrink-0"></span>
                    )}
                    <span className="font-medium truncate max-w-[100px] sm:max-w-none">{status}</span>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex flex-1 sm:flex-initial gap-1 sm:gap-2">
                    {callActive && (
                      <Button
                        onClick={hangupCall}
                        size="sm"
                        className="flex-1 sm:flex-initial bg-red-500 hover:bg-red-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 h-7 sm:h-8 text-[10px] sm:text-xs px-2 sm:px-3"
                      >
                        Hang Up
                      </Button>
                    )}
                    <Button
                      onClick={clearAll}
                      size="sm"
                      variant="secondary"
                      className="flex-1 sm:flex-initial bg-white/20 hover:bg-white/30 text-white border border-white/30 font-semibold backdrop-blur-sm h-7 sm:h-8 text-[10px] sm:text-xs px-2 sm:px-3"
                      disabled={callActive}
                    >
                      Clear
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*,.mp3,.wav,.m4a,.ogg"
                      onChange={handleFileSelect}
                      disabled={isUploading || callActive}
                      className="hidden"
                    />
                    <Button
                      onClick={handleUploadClick}
                      disabled={isUploading || callActive}
                      size="sm"
                      className="flex-1 sm:flex-initial bg-white/20 hover:bg-white/30 text-white border border-white/30 font-semibold backdrop-blur-sm h-7 sm:h-8 text-[10px] sm:text-xs px-2 sm:px-3"
                    >
                      <span className="mr-1 sm:mr-1.5">📁</span> 
                      <span className="hidden sm:inline">{isUploading ? "Uploading..." : "Upload"}</span>
                      <span className="sm:hidden">{isUploading ? "..." : "File"}</span>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Incoming Call Alert */}
              {incomingCall && (
                <div className="bg-green-500/30 border border-white/30 rounded px-2 sm:px-3 py-1.5 sm:py-2 animate-pulse">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-1.5 sm:gap-2">
                    <p className="text-white text-xs sm:text-sm font-semibold">
                      📞 Incoming: {incomingCall.parameters.From}
                    </p>
                    <div className="flex gap-1.5 sm:gap-2">
                      <Button
                        onClick={acceptCall}
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 h-6 sm:h-7 text-xs px-2 sm:px-3"
                      >
                        Accept
                      </Button>
                      <Button
                        onClick={rejectCall}
                        size="sm"
                        variant="destructive"
                        className="h-6 sm:h-7 text-xs px-2 sm:px-3"
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Caller Phone Badge */}
              {callerPhone && !incomingCall && (
                <div className="px-2 py-1 bg-blue-500/30 backdrop-blur-sm border border-blue-300/30 rounded text-[10px] sm:text-xs w-fit">
                  <span className="text-white font-medium">📱 Caller: {callerPhone}</span>
                </div>
              )}

              {/* Status Indicators */}
              <div className="flex flex-wrap gap-1 sm:gap-1.5">
                {isExtracting && (
                  <div className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-blue-500/30 backdrop-blur-sm border border-blue-300/30 rounded text-[10px] sm:text-xs">
                    <span className="text-white font-medium">🤖 Extracting...</span>
                  </div>
                )}
                {isLoadingBillboard && (
                  <div className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-purple-500/30 backdrop-blur-sm border border-purple-300/30 rounded text-[10px] sm:text-xs">
                    <span className="text-white font-medium">📊 Loading pricing...</span>
                  </div>
                )}
                {billboardContext && !isLoadingBillboard && (
                  <div className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-green-500/30 backdrop-blur-sm border border-green-300/30 rounded text-[10px] sm:text-xs">
                    <span className="text-white font-medium">✓ Pricing loaded</span>
                  </div>
                )}
                {extractionError && (
                  <div className="flex-1 min-w-full px-1.5 sm:px-2 py-1 sm:py-1.5 bg-red-500/30 backdrop-blur-sm border border-red-300/30 rounded">
                    <div className="flex items-center justify-between gap-1.5 sm:gap-2">
                      <p className="text-white text-[10px] sm:text-xs font-medium truncate">{extractionError}</p>
                      <div className="flex gap-1 sm:gap-1.5 flex-shrink-0">
                        {canRetry && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={handleRetryExtraction}
                            className="h-5 sm:h-6 text-[10px] sm:text-xs px-1.5 sm:px-2"
                          >
                            Retry
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={clearError}
                          className="h-5 sm:h-6 text-[10px] sm:text-xs px-1.5 sm:px-2 text-white hover:bg-white/20"
                        >
                          ✕
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {overallConfidence > 0 && !isExtracting && !extractionError && (
                  <div className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-green-500/30 backdrop-blur-sm border border-green-300/30 rounded text-[10px] sm:text-xs">
                    <span className="text-white font-medium">✓ Confidence: {overallConfidence}%</span>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-1.5 sm:p-2 flex flex-col flex-1 min-h-0 overflow-hidden">
            <Tabs defaultValue="form" className="w-full flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Responsive Tab List */}
              <TabsList className="grid w-full grid-cols-4 mb-2 sm:mb-4 bg-slate-100 p-0.5 sm:p-1 rounded-lg h-8 sm:h-9 flex-shrink-0">
                <TabsTrigger
                  value="form"
                  className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-[10px] sm:text-xs"
                >
                  <span className="hidden sm:inline">Lead Form & Pricing</span>
                  <span className="sm:hidden">Form</span>
                </TabsTrigger>
                <TabsTrigger
                  value="map"
                  className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-[10px] sm:text-xs"
                >
                  <span className="hidden sm:inline">Google Map</span>
                  <span className="sm:hidden">Map</span>
                </TabsTrigger>
                <TabsTrigger
                  value="arcgis"
                  className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-[10px] sm:text-xs"
                >
                  <span className="hidden sm:inline">BSI Map</span>
                  <span className="sm:hidden">BSI</span>
                </TabsTrigger>
                <TabsTrigger
                  value="transcript"
                  className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-[10px] sm:text-xs"
                >
                  <span className="hidden sm:inline">Transcript</span>
                  <span className="sm:hidden">Trans</span>
                </TabsTrigger>
              </TabsList>

              {/* Form + Pricing Tab - Stack on mobile, side-by-side on xl+ */}
              <TabsContent value="form" className="mt-0 flex-1 min-h-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
                <div className="flex flex-col xl:flex-row gap-2 sm:gap-1 h-full min-h-0 overflow-hidden">
                  <LeadForm
                    key={resetTrigger}
                    resetTrigger={resetTrigger}
                    inboundPhone={callerPhone}
                  />
                  <PricingPanel
                    isLoading={isLoadingBillboard}
                    billboardContext={billboardContext}
                    hasTranscripts={transcripts.length > 0}
                    onNutshellSubmit={handleNutshellSubmit}
                    isSubmittingNutshell={isSubmittingNutshell}
                    nutshellStatus={nutshellStatus}
                    nutshellMessage={nutshellMessage}
                    fullTranscript={fullTranscript}
                    setIsLoadingBillboard={setIsLoadingBillboard}
                    setBillboardContext={setBillboardContext}
                  />
                </div>
              </TabsContent>

              {/* Map Tab */}
              <TabsContent value="map" className="mt-0 flex-1 min-h-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
                <div className="h-full overflow-hidden">
                  <GoogleMapPanel
                    initialLocation={currentMarketLocation}
                  />
                </div>
              </TabsContent>

              {/* ArcGIS Map Tab */}
              <TabsContent value="arcgis" className="mt-0 flex-1 min-h-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
                <div className="h-full overflow-hidden">
                  <ArcGISMapPanel
                    initialLocation={currentMarketLocation}
                  />
                </div>
              </TabsContent>

              {/* Transcript Tab */}
              <TabsContent value="transcript" className="mt-0 flex-1 min-h-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
                <div className="h-full overflow-hidden">
                  <TranscriptView
                    ref={scrollRef}
                    transcripts={transcripts}
                    interimTranscript={interimTranscript}
                    interimSpeaker={interimSpeaker}
                    twilioReady={twilioReady}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}