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

// ✅ NEW: Hook now accepts an optional callback for when extraction completes
interface UseBillboardFormExtractionOptions {
  onExtracted?: (data: Partial<BillboardFormData>) => void;
}

export function useBillboardFormExtraction(options: UseBillboardFormExtractionOptions = {}) {
  const { onExtracted } = options;
  
  const lastProcessedTranscriptRef = useRef<string>("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isCleared, setIsCleared] = useState(false);
  
  // Store the final completed result separately from streaming partial
  const [completedFormData, setCompletedFormData] = useState<Partial<BillboardFormData> | null>(null);
  
  // ✅ Track extraction count to force updates
  const [extractionCount, setExtractionCount] = useState(0);
  
  const MAX_RETRIES = 3;

  const { object, submit, isLoading, error, stop } = useObject({
    api: "/api/extract-billboard-fields",
    schema: billboardLeadSchema,
    onError: (error) => {
      console.error("❌ Extraction error:", error);
      setExtractionError(error.message || "Failed to extract fields");
    },
    onFinish: ({ object: finalObject }) => {
      console.log("✅ Extraction completed:", finalObject);
      setExtractionError(null);
      setRetryCount(0);
      setIsCleared(false);
      
      if (finalObject) {
        const data = finalObject as Partial<BillboardFormData>;
        setCompletedFormData(data);
        setExtractionCount(prev => prev + 1);
        
        // ✅ Call the callback directly when extraction completes
        // This is more reliable than using useEffect
        if (onExtracted) {
          console.log("📤 Calling onExtracted with:", data);
          onExtracted(data);
        }
      }
    },
  });

  const extractFields = useCallback(
    (newTranscript: string) => {
      if (isLoading) {
        console.log("⏳ Extraction already in progress, skipping...");
        return;
      }

      // ✅ REMOVED: Don't skip if transcript is the same
      // This was preventing re-extraction when client corrects info
      // The transcript WILL be different if client said something new

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
          console.log("🚀 Starting extraction for transcript length:", newTranscript.length);
          lastProcessedTranscriptRef.current = newTranscript;

          submit({ transcript: newTranscript });

          setRetryCount((prev) => prev + 1);
        } catch (err) {
          console.error("❌ Error submitting extraction:", err);
          setExtractionError(err instanceof Error ? err.message : "Unknown error");
        }
      }, 500); // 500ms debounce
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
    // Return completed data (final), not streaming partial
    formData: isCleared ? null : completedFormData,
    
    // Also expose streaming object if you want to show live preview
    streamingFormData: isCleared ? null : object,
    
    // ✅ NEW: Extraction count - useful for triggering effects
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