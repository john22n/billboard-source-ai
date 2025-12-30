// hooks/useBillboardFormExtraction.ts
"use client";

import { experimental_useObject as useObject } from "@ai-sdk/react";
import { billboardLeadSchema } from "@/lib/schemas";
import { useCallback, useRef, useState, useMemo } from "react";
import { LeadSentiment } from "@/types/sales-call";

export interface BillboardFormData {
  // Lead classification - NOW USING ENUM
  leadType: LeadSentiment | null;
  
  // Entity information
  typeName?: "business" | "political" | "nonprofit" | "personal" | string | null;
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
  hasMediaExperience: boolean | string | null;
  yearsInBusiness: string | null;
  
  // Notes
  notes: string | null;
}

// ✅ Helper: Deep equality check for values
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (a === undefined || b === undefined) return a === b;
  
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }
  
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => 
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
  }
  
  return false;
}

// ✅ All form field keys (excluding confidence)
const FORM_FIELDS: (keyof BillboardFormData)[] = [
  'leadType',
  'typeName',
  'businessName',
  'entityName',
  'name',
  'position',
  'phone',
  'email',
  'website',
  'decisionMaker',
  'sendOver',
  'billboardsBeforeYN',
  'billboardsBeforeDetails',
  'billboardPurpose',
  'accomplishDetails',
  'targetAudience',
  'targetCity',
  'state',
  'targetArea',
  'startMonth',
  'campaignLength',
  'boardType',
  'hasMediaExperience',
  'yearsInBusiness',
  'notes',
];

// ✅ Empty form data template
const EMPTY_FORM_DATA: BillboardFormData = {
  leadType: null,
  typeName: null,
  businessName: null,
  entityName: null,
  name: null,
  position: null,
  phone: null,
  email: null,
  website: null,
  decisionMaker: null,
  sendOver: null,
  billboardsBeforeYN: null,
  billboardsBeforeDetails: null,
  billboardPurpose: null,
  accomplishDetails: null,
  targetAudience: null,
  targetCity: null,
  state: null,
  targetArea: null,
  startMonth: null,
  campaignLength: null,
  boardType: null,
  hasMediaExperience: null,
  yearsInBusiness: null,
  notes: null,
};

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

  // ✅ NEW: Track the last stable/complete extraction to compare against
  const lastStableDataRef = useRef<Partial<BillboardFormData> | null>(null);
  
  // ✅ NEW: Accumulated form data - only updates when fields actually change
  const [accumulatedFormData, setAccumulatedFormData] = useState<BillboardFormData>(EMPTY_FORM_DATA);
  
  // ✅ NEW: Track which fields have changed since last stable state
  const [changedFields, setChangedFields] = useState<Set<string>>(new Set());

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
      setIsCleared(false);
      
      // ✅ NEW: Save this as the new stable state
      if (object) {
        lastStableDataRef.current = { ...object } as Partial<BillboardFormData>;
      }
    },
  });

  // ✅ NEW: Compute differential updates when object changes
  // This effect runs when the streaming object updates, but only applies
  // changes to accumulatedFormData for fields that actually differ
  useMemo(() => {
    if (!object || isCleared) return;

    const newChangedFields = new Set<string>();
    let hasAnyChanges = false;

    setAccumulatedFormData(prev => {
      const updated = { ...prev };
      
      for (const field of FORM_FIELDS) {
        // Use type-safe access with the field as keyof BillboardFormData
        const newValue = object[field as keyof typeof object];
        const prevValue = prev[field];
        
        // Only update if the value actually changed
        if (!deepEqual(newValue, prevValue) && newValue !== undefined) {
          // Type-safe assignment
          (updated[field] as typeof newValue) = newValue;
          newChangedFields.add(field);
          hasAnyChanges = true;
        }
      }
      
      // Only return new object if something changed
      if (hasAnyChanges) {
        console.log("🔄 Fields updated:", Array.from(newChangedFields));
        return updated;
      }
      return prev;
    });

    if (newChangedFields.size > 0) {
      setChangedFields(prev => {
        const merged = new Set(prev);
        newChangedFields.forEach(f => merged.add(f));
        return merged;
      });
    }
  }, [object, isCleared]);

  const addTranscriptContext = useCallback((text: string) => {
    transcriptContextRef.current.push(text);
    if (transcriptContextRef.current.length > 10) {
      transcriptContextRef.current.shift();
    }
  }, []);

  const extractFields = useCallback(
    (newTranscript: string) => {
      if (isProcessingRef.current) {
        console.log("⏳ Extraction already in progress, skipping...");
        return;
      }

      if (lastProcessedTranscriptRef.current === newTranscript) {
        console.log("⏭️ Transcript already processed, skipping...");
        return;
      }

      if (!newTranscript || newTranscript.trim().length < 10) {
        console.log("⚠️ Transcript too short, skipping extraction");
        return;
      }

      if (retryCount >= MAX_RETRIES) {
        console.error("🚫 Max retries reached, stopping extraction");
        setExtractionError("Maximum retry attempts reached. Please refresh the page.");
        return;
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

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
      }, 500);
    },
    [submit, addTranscriptContext, retryCount]
  );

  const clearError = useCallback(() => {
    setExtractionError(null);
    setRetryCount(0);
  }, []);

  const reset = useCallback(() => {
    if (isProcessingRef.current) {
      stop();
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    transcriptContextRef.current = [];
    lastProcessedTranscriptRef.current = "";
    isProcessingRef.current = false;
    lastStableDataRef.current = null;
    
    setExtractionError(null);
    setRetryCount(0);
    setIsCleared(true);
    setAccumulatedFormData(EMPTY_FORM_DATA);
    setChangedFields(new Set());
  }, [stop]);

  const cleanup = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  // ✅ NEW: Helper to check if a specific field was recently updated by AI
  const wasFieldUpdatedByAI = useCallback((field: string): boolean => {
    return changedFields.has(field);
  }, [changedFields]);

  // ✅ NEW: Clear the changed fields tracking (call after user confirms values)
  const clearChangedFieldsTracking = useCallback(() => {
    setChangedFields(new Set());
  }, []);

  return {
    // ✅ CHANGED: Return accumulated form data instead of raw streaming object
    formData: isCleared ? null : accumulatedFormData,
    
    // ✅ NEW: Also expose the raw streaming object if needed for debugging
    rawStreamingObject: object,
    
    isExtracting: isLoading || isProcessingRef.current,
    extractFields,
    error: extractionError || error?.message,
    overallConfidence: isCleared ? 0 : (object?.confidence?.overall ?? 0),
    clearError,
    reset,
    cleanup,
    canRetry: retryCount < MAX_RETRIES,
    
    // ✅ NEW: Expose changed fields tracking
    changedFields,
    wasFieldUpdatedByAI,
    clearChangedFieldsTracking,
  };
}