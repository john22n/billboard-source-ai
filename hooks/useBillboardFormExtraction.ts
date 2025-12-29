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

// Fields that can be locked by user confirmation
export type LockableField = keyof BillboardFormData;

export function useBillboardFormExtraction() {
  const transcriptContextRef = useRef<string[]>([]);
  const lastProcessedTranscriptRef = useRef<string>("");
  const lastProcessedLengthRef = useRef<number>(0); // Track transcript length for incremental processing
  const isProcessingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // ✅ NEW: Store the current extracted form data for incremental updates
  const currentFormDataRef = useRef<Partial<BillboardFormData>>({});
  
  // ✅ NEW: Track which fields are "locked" (user confirmed - green state)
  const lockedFieldsRef = useRef<Set<string>>(new Set());

  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isCleared, setIsCleared] = useState(false);
  const MAX_RETRIES = 3;
  
  // ✅ NEW: Minimum new content required before re-extraction (characters)
  const MIN_NEW_CONTENT = 30;

  const { object, submit, isLoading, error, stop } = useObject({
    api: "/api/extract-billboard-fields",
    schema: billboardLeadSchema,
    onError: (error) => {
      console.error("❌ Extraction error:", error);
      setExtractionError(error.message || "Failed to extract fields");
      isProcessingRef.current = false;
    },
    onFinish: (result) => {
      console.log("✅ Extraction completed successfully");
      setExtractionError(null);
      setRetryCount(0);
      isProcessingRef.current = false;
      setIsCleared(false);
      
      // ✅ Store the latest extraction result for next incremental update
      if (result.object) {
        currentFormDataRef.current = { ...currentFormDataRef.current, ...result.object };
      }
    },
  });

  const addTranscriptContext = useCallback((text: string) => {
    transcriptContextRef.current.push(text);
    // Keep only last 10 transcript chunks for context
    if (transcriptContextRef.current.length > 10) {
      transcriptContextRef.current.shift();
    }
  }, []);

  // ✅ NEW: Lock a field (called when user confirms a value - clicks to make it green)
  const lockField = useCallback((field: string) => {
    lockedFieldsRef.current.add(field);
    console.log(`🔒 Locked field: ${field}`);
  }, []);

  // ✅ NEW: Unlock a field (if user wants AI to update it again)
  const unlockField = useCallback((field: string) => {
    lockedFieldsRef.current.delete(field);
    console.log(`🔓 Unlocked field: ${field}`);
  }, []);

  // ✅ NEW: Check if a field is locked
  const isFieldLocked = useCallback((field: string) => {
    return lockedFieldsRef.current.has(field);
  }, []);

  // ✅ NEW: Get all locked fields
  const getLockedFields = useCallback(() => {
    return Array.from(lockedFieldsRef.current);
  }, []);

  // ✅ NEW: Set current form data (for syncing with parent component's manual edits)
  const setCurrentFormData = useCallback((data: Partial<BillboardFormData>) => {
    currentFormDataRef.current = { ...currentFormDataRef.current, ...data };
  }, []);

  const extractFields = useCallback(
    (newTranscript: string, forceFullExtraction: boolean = false) => {
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

      // ✅ NEW: Check if there's enough new content to warrant re-extraction
      const newContentLength = newTranscript.length - lastProcessedLengthRef.current;
      if (!forceFullExtraction && newContentLength < MIN_NEW_CONTENT && lastProcessedLengthRef.current > 0) {
        console.log(`⏭️ Not enough new content (${newContentLength} chars), skipping...`);
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
          console.log("🚀 Starting incremental extraction...");
          isProcessingRef.current = true;
          
          // ✅ Calculate the new segment of transcript (for change detection)
          const previousLength = lastProcessedLengthRef.current;
          const newSegment = previousLength > 0 
            ? newTranscript.substring(previousLength) 
            : "";
          
          lastProcessedTranscriptRef.current = newTranscript;
          lastProcessedLengthRef.current = newTranscript.length;

          addTranscriptContext(newTranscript);

          // ✅ NEW: Send current form state and locked fields for incremental extraction
          submit({
            transcript: newTranscript,
            newSegment: newSegment, // The new part of the conversation
            previousContext: transcriptContextRef.current,
            currentFormState: currentFormDataRef.current, // What we've already extracted
            lockedFields: Array.from(lockedFieldsRef.current), // Fields user has confirmed
            isIncremental: previousLength > 0 && !forceFullExtraction, // Flag for incremental mode
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
    lastProcessedLengthRef.current = 0;
    isProcessingRef.current = false;
    currentFormDataRef.current = {};
    lockedFieldsRef.current.clear();
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
    // ✅ NEW: Expose field locking functionality
    lockField,
    unlockField,
    isFieldLocked,
    getLockedFields,
    setCurrentFormData,
  };
}