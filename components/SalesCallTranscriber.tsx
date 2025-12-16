"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBillboardFormExtraction, type BillboardFormData } from "@/hooks/useBillboardFormExtraction";
import { useTwilio } from "@/hooks/useTwilio";
import { useOpenAITranscription } from "@/hooks/useOpenAITranscription";
import { LeadForm, PricingPanel, TranscriptView, GoogleMapPanel, ArcGISMapPanel } from "@/components/sales-call";
import type { ContactData, MarketData } from "@/components/sales-call/LeadForm";
import type { TranscriptItem } from "@/types/sales-call";

export default function SalesCallTranscriber() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastFetchedTranscript = useRef<string>("");

  const [isUploading, setIsUploading] = useState(false);
  const [billboardContext, setBillboardContext] = useState<string>("");
  const [isLoadingBillboard, setIsLoadingBillboard] = useState(false);
  const [isSubmittingNutshell, setIsSubmittingNutshell] = useState(false);
  const [nutshellStatus, setNutshellStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [nutshellMessage, setNutshellMessage] = useState('');
  const [resetTrigger, setResetTrigger] = useState(0);

  // ✅ ADD: State for additional contacts and markets (lifted from LeadForm)
  const [additionalContacts, setAdditionalContacts] = useState<ContactData[]>([]);
  const [additionalMarkets, setAdditionalMarkets] = useState<MarketData[]>([]);

  // ✅ ADD: State for active indices (lifted from LeadForm)
  const [activeContactIndex, setActiveContactIndex] = useState(0);
  const [activeMarketIndex, setActiveMarketIndex] = useState(0);

  // ✅ ADD: State for ballpark (lifted from LeadForm)
  const [ballpark, setBallpark] = useState("");

  // ✅ ADD: State for Twilio phone (lifted from LeadForm)
  const [twilioPhone, setTwilioPhone] = useState("");
  const [twilioPhonePreFilled, setTwilioPhonePreFilled] = useState(false);  // ✅ NEW: Track if phone was pre-filled

  // ✅ ADD: State for user confirmations (lifted from LeadForm)
  const [confirmedLeadType, setConfirmedLeadType] = useState<string | null>(null);
  const [confirmedDecisionMakers, setConfirmedDecisionMakers] = useState<{[contactIndex: number]: string | null}>({});
  const [confirmedBoardTypes, setConfirmedBoardTypes] = useState<{[marketIndex: number]: string | null}>({});
  const [confirmedDurations, setConfirmedDurations] = useState<{[marketIndex: number]: string[]}>({});
  const [confirmedSendOver, setConfirmedSendOver] = useState<{[contactIndex: number]: string[]}>({});

  // Custom hooks for Twilio and transcription
  const {
    transcripts,
    interimTranscript,
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
  } = useTwilio({
    onCallAccepted: (call) => startTranscription(call),
    onCallDisconnected: () => {
      stopTranscription();
      resetStatus();
    },
  });

  // Billboard form extraction hook
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

  // Local state for manual user edits (tracks which fields user has manually changed)
  const [manualEdits, setManualEdits] = useState<Partial<BillboardFormData>>({});
  
  // Track which fields have been manually edited by the user
  const [userEditedFields, setUserEditedFields] = useState<Set<string>>(new Set());

  // Merge AI data with manual edits - manual edits take precedence only for fields user has touched
  const formData: BillboardFormData = useMemo(() => {
    const merged: BillboardFormData = {
      // Lead classification
      leadType: userEditedFields.has('leadType') ? manualEdits.leadType ?? null : aiFormData?.leadType ?? null,
      
      // Entity information
      typeName: userEditedFields.has('typeName') ? manualEdits.typeName ?? null : aiFormData?.typeName ?? null,
      businessName: userEditedFields.has('businessName') ? manualEdits.businessName ?? null : aiFormData?.businessName ?? null,
      entityName: userEditedFields.has('entityName') ? manualEdits.entityName ?? null : aiFormData?.entityName ?? null,
      
      // Contact information
      name: userEditedFields.has('name') ? manualEdits.name ?? null : aiFormData?.name ?? null,
      position: userEditedFields.has('position') ? manualEdits.position ?? null : aiFormData?.position ?? null,
      phone: userEditedFields.has('phone') ? manualEdits.phone ?? null : aiFormData?.phone ?? null,
      email: userEditedFields.has('email') ? manualEdits.email ?? null : aiFormData?.email ?? null,
      website: userEditedFields.has('website') ? manualEdits.website ?? null : aiFormData?.website ?? null,
      decisionMaker: userEditedFields.has('decisionMaker') ? manualEdits.decisionMaker ?? null : aiFormData?.decisionMaker ?? null,
      sendOver: userEditedFields.has('sendOver') ? manualEdits.sendOver ?? null : aiFormData?.sendOver ?? null,
      
      // Billboard experience
      billboardsBeforeYN: userEditedFields.has('billboardsBeforeYN') ? manualEdits.billboardsBeforeYN ?? null : aiFormData?.billboardsBeforeYN ?? null,
      billboardsBeforeDetails: userEditedFields.has('billboardsBeforeDetails') ? manualEdits.billboardsBeforeDetails ?? null : aiFormData?.billboardsBeforeDetails ?? null,
      
      // Campaign details
      billboardPurpose: userEditedFields.has('billboardPurpose') ? manualEdits.billboardPurpose ?? null : aiFormData?.billboardPurpose ?? null,
      accomplishDetails: userEditedFields.has('accomplishDetails') ? manualEdits.accomplishDetails ?? null : aiFormData?.accomplishDetails ?? null,
      targetAudience: userEditedFields.has('targetAudience') ? manualEdits.targetAudience ?? null : aiFormData?.targetAudience ?? null,
      
      // Location (SEPARATED)
      targetCity: userEditedFields.has('targetCity') ? manualEdits.targetCity ?? null : aiFormData?.targetCity ?? null,
      state: userEditedFields.has('state') ? manualEdits.state ?? null : aiFormData?.state ?? null,
      targetArea: userEditedFields.has('targetArea') ? manualEdits.targetArea ?? null : aiFormData?.targetArea ?? null,
      
      // Timeline & preferences
      startMonth: userEditedFields.has('startMonth') ? manualEdits.startMonth ?? null : aiFormData?.startMonth ?? null,
      campaignLength: userEditedFields.has('campaignLength') ? manualEdits.campaignLength ?? null : aiFormData?.campaignLength ?? null,
      boardType: userEditedFields.has('boardType') ? manualEdits.boardType ?? null : aiFormData?.boardType ?? null,
      
      // Business context
      hasMediaExperience: userEditedFields.has('hasMediaExperience') ? manualEdits.hasMediaExperience ?? null : aiFormData?.hasMediaExperience ?? null,
      yearsInBusiness: userEditedFields.has('yearsInBusiness') ? manualEdits.yearsInBusiness ?? null : aiFormData?.yearsInBusiness ?? null,
      
      // Notes
      notes: userEditedFields.has('notes') ? manualEdits.notes ?? null : aiFormData?.notes ?? null,
    };
    
    return merged;
  }, [aiFormData, manualEdits, userEditedFields]);

  const updateField = (field: string, value: string | boolean | string[] | null) => {
    setManualEdits(prev => ({ ...prev, [field]: value }));
    setUserEditedFields(prev => new Set(prev).add(field));
  };

  const clearAll = () => {
    // Clear transcripts first
    clearTranscripts();
    setBillboardContext("");
    lastFetchedTranscript.current = "";
    
    // Clear all form-related state
    setManualEdits({});
    setUserEditedFields(new Set());
    resetExtraction(); // Clear AI extracted data
    
    // Clear additional contacts/markets
    setAdditionalContacts([]);
    setAdditionalMarkets([]);
    
    // Reset active indices
    setActiveContactIndex(0);
    setActiveMarketIndex(0);
    
    // Clear ballpark and phone
    setBallpark("");
    setTwilioPhone("");
    setTwilioPhonePreFilled(false);  // ✅ RESET pre-fill flag
    
    // Clear all confirmations
    setConfirmedLeadType(null);
    setConfirmedDecisionMakers({});
    setConfirmedBoardTypes({});
    setConfirmedDurations({});
    setConfirmedSendOver({});
    
    // Trigger reset in LeadForm
    setResetTrigger(prev => prev + 1);
  };

  const fullTranscript = useMemo(() => {
    return transcripts.map(t => t.text).join(" ");
  }, [transcripts]);

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

  // Extract form fields when transcripts update
  useEffect(() => {
    if (fullTranscript.length > 50 && !isExtracting) {
      extractFields(fullTranscript);
    }
  }, [fullTranscript, extractFields, isExtracting]);

  // Fetch billboard pricing data
  useEffect(() => {
    const fetchBillboardData = async () => {
      const transcriptDiff = fullTranscript.length - lastFetchedTranscript.current.length;

      if (
        fullTranscript.length > 100 &&
        !isLoadingBillboard &&
        (transcriptDiff > 50 || lastFetchedTranscript.current === '')
      ) {
        setIsLoadingBillboard(true);
        lastFetchedTranscript.current = fullTranscript;

        try {
          const response = await fetch('/api/billboard-pricing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: fullTranscript }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.context) {
              setBillboardContext(data.context);
            }
          }
        } catch (error) {
          console.error("Error fetching billboard data:", error);
        } finally {
          setIsLoadingBillboard(false);
        }
      }
    };

    const timeoutId = setTimeout(fetchBillboardData, 1500);
    return () => clearTimeout(timeoutId);
  }, [fullTranscript, isLoadingBillboard]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleNutshellSubmit = async () => {
    setIsSubmittingNutshell(true);
    setNutshellStatus('idle');
    setNutshellMessage('');

    try {
      const response = await fetch('/api/nutshell/create-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Contact information
          name: formData.name || '',
          phone: formData.phone || '',
          email: formData.email || '',
          position: formData.position || '',
          website: formData.website || '',
          decisionMaker: formData.decisionMaker || '',
          
          // Entity information
          typeName: formData.typeName || '',
          businessName: formData.businessName || '',
          entityName: formData.entityName || '',
          
          // Billboard experience
          billboardsBeforeYN: formData.billboardsBeforeYN || '',
          billboardsBeforeDetails: formData.billboardsBeforeDetails || '',
          
          // Campaign details
          billboardPurpose: formData.billboardPurpose || '',
          accomplishDetails: formData.accomplishDetails || '',
          targetAudience: formData.targetAudience || '',
          
          // Location
          targetCity: formData.targetCity || '',
          state: formData.state || '',
          targetArea: formData.targetArea || '',
          
          // Timeline & preferences
          startMonth: formData.startMonth || '',
          campaignLength: formData.campaignLength || '',
          boardType: formData.boardType || '',
          
          // Business context
          hasMediaExperience: formData.hasMediaExperience,
          yearsInBusiness: formData.yearsInBusiness || '',
          
          // Lead classification & notes
          leadType: formData.leadType || '',
          notes: formData.notes || '',
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setNutshellStatus('success');
        setNutshellMessage('Lead created');
      } else {
        setNutshellStatus('error');
        setNutshellMessage(result.error || 'Failed');
      }
    } catch (error) {
      console.error('Error submitting to Nutshell:', error);
      setNutshellStatus('error');
      setNutshellMessage('Connection failed');
    } finally {
      setIsSubmittingNutshell(false);
    }
  };

  const isProcessing = isUploading || isExtracting ||
    status.includes("Fetching") || status.includes("Connecting") ||
    status.includes("Starting") || status.includes("Uploading") ||
    status.includes("Initializing");

  // ✅ Get the currently active market's location for maps
  const getCurrentMarketLocation = () => {
    if (activeMarketIndex === 0) {
      // Primary market - use formData
      return formData.targetCity && formData.state 
        ? `${formData.targetCity}, ${formData.state}` 
        : formData.targetArea || "";
    } else {
      // Additional market - use additionalMarkets
      const market = additionalMarkets[activeMarketIndex - 1];
      if (!market) return "";
      return market.targetCity && market.state
        ? `${market.targetCity}, ${market.state}`
        : market.targetArea || "";
    }
  };

  return (
    <div className="h-full bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-3 lg:p-1 overflow-hidden">
      <div className="h-full max-w-[1800px] mx-auto flex flex-col">
        <Card className="shadow-2xl border-0 overflow-hidden flex flex-col h-full">
          {/* Header */}
          <CardHeader className="bg-gradient-to-r from-blue-600 via-indigo-600 to-primary text-white py-3 px-4">
            <div className="flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle className="text-xl font-bold tracking-tight">
                    Billboard Lead Form
                    {userEmail && (
                      <span className="text-xs font-normal ml-2 opacity-75">
                        ({userEmail})
                      </span>
                    )}
                  </CardTitle>
                  <p className="text-blue-100 text-xs mt-0.5">Real-time transcription & AI-powered data extraction</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className={`px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center gap-2 text-xs ${isProcessing ? "animate-pulse" : ""}`}>
                    {twilioReady && !callActive && (
                      <span className="inline-block w-2 h-2 bg-green-400 rounded-full"></span>
                    )}
                    {callActive && (
                      <span className="inline-block w-2 h-2 bg-red-400 rounded-full animate-pulse"></span>
                    )}
                    <span className="font-medium">{status}</span>
                  </div>
                  <div className="flex gap-2">
                    {callActive && (
                      <Button
                        onClick={hangupCall}
                        size="sm"
                        className="bg-red-500 hover:bg-red-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 h-8 text-xs"
                      >
                        Hang Up
                      </Button>
                    )}
                    <Button
                      onClick={clearAll}
                      size="sm"
                      variant="secondary"
                      className="bg-white/20 hover:bg-white/30 text-white border border-white/30 font-semibold backdrop-blur-sm h-8 text-xs"
                      disabled={callActive}
                    >
                      Clear All
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
                      className="bg-white/20 hover:bg-white/30 text-white border border-white/30 font-semibold backdrop-blur-sm h-8 text-xs"
                    >
                      <span className="mr-1.5">📁</span> {isUploading ? "Uploading..." : "Upload"}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Incoming Call Alert */}
              {incomingCall && (
                <div className="bg-green-500/30 border border-white/30 rounded px-3 py-2 animate-pulse">
                  <div className="flex items-center justify-between">
                    <p className="text-white text-sm font-semibold">
                      📞 Incoming call from {incomingCall.parameters.From}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={acceptCall}
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 h-7 text-sm"
                      >
                        Accept
                      </Button>
                      <Button
                        onClick={rejectCall}
                        size="sm"
                        variant="destructive"
                        className="h-7 text-sm"
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Status Indicators */}
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

          <CardContent className="p-4 flex-1 overflow-hidden flex flex-col">
            <Tabs defaultValue="form" className="w-full h-full flex flex-col">
              <TabsList className="grid w-full grid-cols-4 mb-4 bg-slate-100 p-1 rounded-lg h-9">
                <TabsTrigger
                  value="form"
                  className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-xs"
                >
                  Lead Form & Pricing
                </TabsTrigger>
                <TabsTrigger
                  value="map"
                  className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-xs"
                >
                  Google Map
                </TabsTrigger>
                <TabsTrigger
                  value="arcgis"
                  className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-xs"
                >
                  ArcGIS Map
                </TabsTrigger>
                <TabsTrigger
                  value="transcript"
                  className="data-[state=active]:bg-white data-[state=active]:shadow-sm font-semibold text-xs"
                >
                  Transcript
                </TabsTrigger>
              </TabsList>

              {/* Form + Pricing Tab */}
              <TabsContent value="form" className="mt-0 flex-1 overflow-hidden flex flex-col">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 overflow-y-auto pr-2">
                  <LeadForm 
                    key={resetTrigger}
                    formData={formData} 
                    updateField={updateField} 
                    resetTrigger={resetTrigger}
                    inboundPhone={incomingCall?.parameters?.From}
                    additionalContacts={additionalContacts}           
                    setAdditionalContacts={setAdditionalContacts}     
                    additionalMarkets={additionalMarkets}             
                    setAdditionalMarkets={setAdditionalMarkets}
                    activeContactIndex={activeContactIndex}
                    setActiveContactIndex={setActiveContactIndex}
                    activeMarketIndex={activeMarketIndex}
                    setActiveMarketIndex={setActiveMarketIndex}
                    ballpark={ballpark}
                    setBallpark={setBallpark}
                    twilioPhone={twilioPhone}
                    setTwilioPhone={setTwilioPhone}
                    twilioPhonePreFilled={twilioPhonePreFilled}  // ✅ NEW PROP
                    setTwilioPhonePreFilled={setTwilioPhonePreFilled}  // ✅ NEW PROP
                    confirmedLeadType={confirmedLeadType}
                    setConfirmedLeadType={setConfirmedLeadType}
                    confirmedDecisionMakers={confirmedDecisionMakers}
                    setConfirmedDecisionMakers={setConfirmedDecisionMakers}
                    confirmedBoardTypes={confirmedBoardTypes}
                    setConfirmedBoardTypes={setConfirmedBoardTypes}
                    confirmedDurations={confirmedDurations}
                    setConfirmedDurations={setConfirmedDurations}
                    confirmedSendOver={confirmedSendOver}
                    setConfirmedSendOver={setConfirmedSendOver}
                  />
                  <PricingPanel
                    isLoading={isLoadingBillboard}
                    billboardContext={billboardContext}
                    hasTranscripts={transcripts.length > 0}
                  />
                </div>
                <div className="flex justify-end items-center gap-2 pt-3 border-t border-slate-200 mt-3">
                  {nutshellStatus !== 'idle' && (
                    <span className={`text-xs font-medium ${nutshellStatus === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                      {nutshellMessage}
                    </span>
                  )}
                  <Button
                    onClick={handleNutshellSubmit}
                    disabled={isSubmittingNutshell}
                    className="bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 h-9 px-4"
                  >
                    {isSubmittingNutshell ? 'Submitting...' : 'Nutshell'}
                  </Button>
                </div>
              </TabsContent>

              {/* Map Tab */}
              <TabsContent value="map" className="mt-0 flex-1 overflow-hidden">
                <GoogleMapPanel
                  initialLocation={getCurrentMarketLocation()}
                />
              </TabsContent>

              {/* ArcGIS Map Tab */}
              <TabsContent value="arcgis" className="mt-0 flex-1 overflow-hidden">
                <ArcGISMapPanel
                  initialLocation={getCurrentMarketLocation()}
                />
              </TabsContent>

              {/* Transcript Tab */}
              <TabsContent value="transcript" className="mt-0 flex-1 overflow-hidden">
                <TranscriptView
                  ref={scrollRef}
                  transcripts={transcripts}
                  interimTranscript={interimTranscript}
                  twilioReady={twilioReady}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}