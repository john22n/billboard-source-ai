// hooks/useBillboardFormExtraction.ts
"use client";

import { experimental_useObject as useObject } from "@ai-sdk/react";
import { billboardLeadSchema } from "@/lib/schemas";
import { useCallback, useRef, useState } from "react";
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
  const transcriptContextRef = useRef<string[]>([]);
  const lastProcessedTranscriptRef = useRef<string>("");
  const isProcessingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isCleared, setIsCleared] = useState(false);
  const MAX_RETRIES = 3;

  const { object, submit, isLoading, error, stop } = useObject({
    api: "/api/extract-billboard-fields",
    schema: billboardLeadSchema,
    onError: (error) => {
      console.error("❌ Extraction error:", error);
      setExtractionError(error.message || "Failed to extract fields");
      isProcessingRef.current = false;
    },
    onFinish: () => {
      console.log("✅ Extraction completed successfully");
      setExtractionError(null);
      setRetryCount(0);
      isProcessingRef.current = false;
      setIsCleared(false); // ✅ Reset isCleared when new data arrives
    },
  });

  const addTranscriptContext = useCallback((text: string) => {
    transcriptContextRef.current.push(text);
    // Keep only last 10 transcript chunks for context
    if (transcriptContextRef.current.length > 10) {
      transcriptContextRef.current.shift();
    }
  }, []);

  const extractFields = useCallback(
    (newTranscript: string) => {
      // Prevent processing if already in progress
      if (isProcessingRef.current) {
        console.log("⏳ Extraction already in progress, skipping...");
        return;
      }

      // Prevent duplicate processing of same transcript
      if (lastProcessedTranscriptRef.current === newTranscript) {
        console.log("⏭️ Transcript already processed, skipping...");
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

      // Abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      // Debounce the actual API call
      debounceTimerRef.current = setTimeout(() => {
        try {
          console.log("🚀 Starting extraction...");
          isProcessingRef.current = true;
          lastProcessedTranscriptRef.current = newTranscript;

          addTranscriptContext(newTranscript);

          submit({
            transcript: newTranscript,
            previousContext: transcriptContextRef.current,
          });

          setRetryCount((prev) => prev + 1);
        } catch (err) {
          console.error("❌ Error submitting extraction:", err);
          setExtractionError(err instanceof Error ? err.message : "Unknown error");
          isProcessingRef.current = false;
        }
      }, 500); // 500ms debounce
    },
    [submit, addTranscriptContext, retryCount]
  );

  const clearError = useCallback(() => {
    setExtractionError(null);
    setRetryCount(0);
  }, []);

  const reset = useCallback(() => {
    // Stop any in-progress extraction
    if (isProcessingRef.current) {
      stop();
    }

    // Clear timers and abort controllers
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Reset state
    transcriptContextRef.current = [];
    lastProcessedTranscriptRef.current = "";
    isProcessingRef.current = false;
    setExtractionError(null);
    setRetryCount(0);
    setIsCleared(true);
  }, [stop]);

  // Cleanup on unmount
  const cleanup = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    formData: isCleared ? null : object, // Return null when cleared
    isExtracting: isLoading || isProcessingRef.current,
    extractFields,
    error: extractionError || error?.message,
    overallConfidence: isCleared ? 0 : (object?.confidence?.overall ?? 0),
    clearError,
    reset,
    cleanup,
    canRetry: retryCount < MAX_RETRIES,
  };
}