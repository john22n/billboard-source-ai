// hooks/useBillboardFormExtraction.ts
"use client";

import { experimental_useObject as useObject } from "@ai-sdk/react";
import { billboardLeadSchema } from "@/lib/schemas";
import { useCallback, useRef, useState, useEffect } from "react";
import { LeadSentiment } from "@/types/sales-call";

export interface BillboardFormData {
  // Lead classification - NOW USING ENUM
  leadType: LeadSentiment | null;
  
  // Entity information
  typeName?: "business" | "political" | "nonprofit" | "personal" | null;
  businessName?: string | null;
  entityName?: string | null;
  
  // Contact information
  name: string | null;
  position?: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  decisionMaker: "alone" | "partners" | "boss" | "committee" | null;
  sendOver: ("Avails" | "Panel Info" | "Planning Rates" | undefined)[] | null;
  
  // Billboard experience
  billboardsBeforeYN?: string | null;
  billboardsBeforeDetails?: string | null;
  
  // Campaign details
  billboardPurpose: string | null;
  accomplishDetails?: string | null;
  targetAudience?: string | null;
  
  // Location (SEPARATED)
  targetCity?: string | null;
  state?: string | null;
  targetArea: string | null;
  
  // Timeline & preferences
  startMonth: string | null;
  campaignLength: string[] | string | null;
  boardType?: string | null;
  
  // Business context
  hasMediaExperience: boolean | null;
  yearsInBusiness: string | null;
  
  // Notes
  notes: string | null;
}

export function useBillboardFormExtraction() {
  const lastProcessedTranscriptRef = useRef<string>("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isCleared, setIsCleared] = useState(false);
  
  // Store the final completed result separately from streaming partial
  const [completedFormData, setCompletedFormData] = useState<Partial<BillboardFormData> | null>(null);
  
  // Track previous loading state to detect completion
  const prevIsLoadingRef = useRef<boolean>(false);
  
  // Track extraction count to force re-renders
  const [extractionCount, setExtractionCount] = useState(0);
  
  const MAX_RETRIES = 3;

  const { object, submit, isLoading, error, stop } = useObject({
    api: "/api/extract-billboard-fields",
    schema: billboardLeadSchema,
    onError: (err) => {
      console.error("❌ Extraction error:", err);
      setExtractionError(err.message || "Failed to extract fields");
    },
    onFinish: ({ object: finalObject }) => {
      console.log("✅ Extraction completed via onFinish:", finalObject);
      setExtractionError(null);
      setRetryCount(0);
      setIsCleared(false);
      
      if (finalObject) {
        const data = finalObject as Partial<BillboardFormData>;
        setCompletedFormData(data);
        setExtractionCount(prev => prev + 1);
      }
    },
  });

  // Backup: Detect when loading completes and capture final object
  // This fires if onFinish doesn't work properly
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) {
      // Transition from loading → not loading
      if (object) {
        console.log("🏁 Stream completed (backup detection):", object);
        setCompletedFormData(object as Partial<BillboardFormData>);
        setExtractionCount(prev => prev + 1);
      }
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, object]);

  const extractFields = useCallback(
    (newTranscript: string) => {
      if (isLoading) {
        console.log("⏳ Extraction already in progress, skipping...");
        return;
      }

      // Validate transcript
      if (!newTranscript || newTranscript.trim().length < 10) {
        console.log("⚠️ Transcript too short, skipping extraction");
        return;
      }

      // Check retry limit
      if (retryCount >= MAX_RETRIES) {
        console.error("🚫 Max retries reached, stopping extraction");
        setExtractionError("Maximum retry attempts reached. Please refresh the page.");
        return;
      }

      // Clear any existing debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Stop any in-flight streaming request
      stop();

      // Debounce the actual API call
      debounceTimerRef.current = setTimeout(() => {
        try {
          console.log("🚀 Starting extraction, transcript length:", newTranscript.length);
          lastProcessedTranscriptRef.current = newTranscript;

          submit({ transcript: newTranscript });

          setRetryCount((prev) => prev + 1);
        } catch (err) {
          console.error("❌ Error submitting extraction:", err);
          setExtractionError(err instanceof Error ? err.message : "Unknown error");
        }
      }, 500);
    },
    [submit, retryCount, isLoading, stop]
  );

  const clearError = useCallback(() => {
    setExtractionError(null);
    setRetryCount(0);
  }, []);

  const reset = useCallback(() => {
    stop();

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    lastProcessedTranscriptRef.current = "";
    setExtractionError(null);
    setRetryCount(0);
    setIsCleared(true);
    setCompletedFormData(null);
    setExtractionCount(0);
  }, [stop]);

  const cleanup = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    stop();
  }, [stop]);

  return {
    formData: isCleared ? null : completedFormData,
    streamingFormData: isCleared ? null : object,
    extractionCount,
    isExtracting: isLoading,
    extractFields,
    error: extractionError || error?.message,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    overallConfidence: isCleared ? 0 : ((completedFormData as any)?.confidence?.overall ?? 0),
    clearError,
    reset,
    cleanup,
    canRetry: retryCount < MAX_RETRIES,
  };
}