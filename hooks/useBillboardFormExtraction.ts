// hooks/useBillboardFormExtraction.ts
'use client'

import { experimental_useObject as useObject } from '@ai-sdk/react'
import { billboardLeadSchema } from '@/lib/schemas'
import { useCallback, useRef, useState, useEffect } from 'react'
import { LeadSentiment } from '@/types/sales-call'
import { useFormStore } from '@/stores/formStore'

export interface BillboardFormData {
  // Lead classification - NOW USING ENUM
  leadType: LeadSentiment | null

  // Entity information
  typeName?: string | null
  businessName?: string | null
  entityName?: string | null

  // Contact information
  name: string | null
  position?: string | null
  phone: string | null
  email: string | null
  website: string | null
  decisionMaker: 'alone' | 'partners' | 'boss' | 'committee' | null
  sendOver: ('Avails' | 'Panel Info' | 'Planning Rates' | undefined)[] | null

  // Billboard experience
  billboardsBeforeYN?: string | null
  billboardsBeforeDetails?: string | null

  // Campaign details
  billboardPurpose: string | null
  accomplishDetails?: string | null
  targetAudience?: string | null

  // Location (SEPARATED)
  targetCity?: string | null
  state?: string | null
  targetArea: string | null

  // Timeline & preferences
  startMonth: string | null
  campaignLength: string[] | string | null
  boardType?: string | null

  // Business context
  hasMediaExperience: boolean | null
  yearsInBusiness: string | null

  // Notes
  notes: string | null
}

export function useBillboardFormExtraction() {
  const lastProcessedTranscriptRef = useRef<string>('')
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [isCleared, setIsCleared] = useState(false)

  // Store the final completed result separately from streaming partial
  const [completedFormData, setCompletedFormData] =
    useState<Partial<BillboardFormData> | null>(null)

  // Track previous loading state to detect completion
  const prevIsLoadingRef = useRef<boolean>(false)

  // Track extraction count to force re-renders
  const [extractionCount, setExtractionCount] = useState(0)

  // Track which fields have been applied from the current streaming session
  // to avoid re-applying unchanged partial data on every render
  const appliedStreamFieldsRef = useRef<Record<string, unknown>>({})
  // Throttle streaming updates to avoid overwhelming the store
  const streamThrottleRef = useRef<NodeJS.Timeout | null>(null)

  const MAX_RETRIES = 3

  // ✅ Get the smart merge function from the form store
  const updateFromAI = useFormStore((s) => s.updateFromAI)
  const resetStore = useFormStore((s) => s.reset)

  const { object, submit, isLoading, error, stop } = useObject({
    api: '/api/extract-billboard-fields',
    schema: billboardLeadSchema,
    onError: (err) => {
      console.error('❌ Extraction error:', err)
      setExtractionError(err.message || 'Failed to extract fields')
    },
    onFinish: ({ object: finalObject }) => {
      console.log('✅ Extraction completed via onFinish:', finalObject)
      setExtractionError(null)
      setRetryCount(0)
      setIsCleared(false)

      // Clear any pending streaming throttle
      if (streamThrottleRef.current) {
        clearTimeout(streamThrottleRef.current)
        streamThrottleRef.current = null
      }

      if (finalObject) {
        const data = finalObject as Partial<BillboardFormData>

        // ✅ Final merge — only push fields that actually differ from the store
        const storeFields = useFormStore.getState().fields
        const changed: Partial<BillboardFormData> = {}
        for (const [key, value] of Object.entries(data)) {
          if (key === 'confidence') continue
          if (value === null || value === undefined) continue
          const current = storeFields[key as keyof BillboardFormData]
          if (
            current !== null &&
            current !== undefined &&
            JSON.stringify(current) === JSON.stringify(value)
          )
            continue
          changed[key as keyof BillboardFormData] = value as never
        }
        if (Object.keys(changed).length > 0) {
          updateFromAI(changed)
        }

        setCompletedFormData(data)
        setExtractionCount((prev) => prev + 1)
      }

      // Reset streaming tracker for next extraction
      appliedStreamFieldsRef.current = {}
    },
  })

  // ✅ Apply streaming partial data to the form as it arrives (throttled)
  // Only calls updateFromAI when a streamed value differs from the current store value.
  useEffect(() => {
    if (!isLoading || !object || isCleared) return

    const partial = object as Partial<BillboardFormData>
    const storeFields = useFormStore.getState().fields
    let hasNew = false

    for (const [key, value] of Object.entries(partial)) {
      if (key === 'confidence') continue
      if (value === null || value === undefined) continue
      if (typeof value === 'string' && value.trim() === '') continue
      if (Array.isArray(value) && value.length === 0) continue

      // Already applied this exact value from this stream
      const prev = appliedStreamFieldsRef.current[key]
      if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(value))
        continue

      // Store already has this exact value — mark applied and skip
      const current = storeFields[key as keyof BillboardFormData]
      if (
        current !== null &&
        current !== undefined &&
        JSON.stringify(current) === JSON.stringify(value)
      ) {
        appliedStreamFieldsRef.current[key] = value
        continue
      }

      hasNew = true
      break
    }

    if (!hasNew) return

    // Throttle store updates to max every 300ms during streaming
    if (streamThrottleRef.current) return

    streamThrottleRef.current = setTimeout(() => {
      streamThrottleRef.current = null

      const currentPartial = object as Partial<BillboardFormData>
      const currentStoreFields = useFormStore.getState().fields
      const fieldsToApply: Partial<BillboardFormData> = {}

      for (const [key, value] of Object.entries(currentPartial)) {
        if (key === 'confidence') continue
        if (value === null || value === undefined) continue
        if (typeof value === 'string' && value.trim() === '') continue
        if (Array.isArray(value) && value.length === 0) continue

        const prev = appliedStreamFieldsRef.current[key]
        if (
          prev !== undefined &&
          JSON.stringify(prev) === JSON.stringify(value)
        )
          continue

        // Skip if store already has this exact value
        const current = currentStoreFields[key as keyof BillboardFormData]
        if (
          current !== null &&
          current !== undefined &&
          JSON.stringify(current) === JSON.stringify(value)
        ) {
          appliedStreamFieldsRef.current[key] = value
          continue
        }

        fieldsToApply[key as keyof BillboardFormData] = value as never
        appliedStreamFieldsRef.current[key] = value
      }

      if (Object.keys(fieldsToApply).length > 0) {
        updateFromAI(fieldsToApply)
      }
    }, 300)
  }, [isLoading, object, isCleared, updateFromAI])

  // Backup: Detect when loading completes and capture final object
  // This fires if onFinish doesn't work properly
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) {
      // Transition from loading → not loading
      if (object) {
        console.log('🏁 Stream completed (backup detection):', object)

        // ✅ Only push fields that actually differ from the store
        const data = object as Partial<BillboardFormData>
        const storeFields = useFormStore.getState().fields
        const changed: Partial<BillboardFormData> = {}
        for (const [key, value] of Object.entries(data)) {
          if (key === 'confidence') continue
          if (value === null || value === undefined) continue
          const current = storeFields[key as keyof BillboardFormData]
          if (
            current !== null &&
            current !== undefined &&
            JSON.stringify(current) === JSON.stringify(value)
          )
            continue
          changed[key as keyof BillboardFormData] = value as never
        }
        if (Object.keys(changed).length > 0) {
          updateFromAI(changed)
        }

        setCompletedFormData(data)
        setExtractionCount((prev) => prev + 1)
      }
      // Reset streaming tracker
      appliedStreamFieldsRef.current = {}
    }
    prevIsLoadingRef.current = isLoading
  }, [isLoading, object, updateFromAI])

  const extractFields = useCallback(
    (newTranscript: string) => {
      if (isLoading) {
        console.log('⏳ Extraction already in progress, skipping...')
        return
      }

      // Validate transcript
      if (!newTranscript || newTranscript.trim().length < 10) {
        console.log('⚠️ Transcript too short, skipping extraction')
        return
      }

      // Check retry limit
      if (retryCount >= MAX_RETRIES) {
        console.error('🚫 Max retries reached, stopping extraction')
        setExtractionError(
          'Maximum retry attempts reached. Please refresh the page.',
        )
        return
      }

      // Clear any existing debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      // Stop any in-flight streaming request
      stop()

      // Debounce the actual API call
      debounceTimerRef.current = setTimeout(() => {
        try {
          console.log(
            '🚀 Starting extraction, transcript length:',
            newTranscript.length,
          )
          lastProcessedTranscriptRef.current = newTranscript

          // Reset streaming tracker for the new extraction
          appliedStreamFieldsRef.current = {}

          submit({ transcript: newTranscript })

          setRetryCount((prev) => prev + 1)
        } catch (err) {
          console.error('❌ Error submitting extraction:', err)
          setExtractionError(
            err instanceof Error ? err.message : 'Unknown error',
          )
        }
      }, 300)
    },
    [submit, retryCount, isLoading, stop],
  )

  const clearError = useCallback(() => {
    setExtractionError(null)
    setRetryCount(0)
  }, [])

  const reset = useCallback(() => {
    stop()

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    if (streamThrottleRef.current) {
      clearTimeout(streamThrottleRef.current)
      streamThrottleRef.current = null
    }

    lastProcessedTranscriptRef.current = ''
    appliedStreamFieldsRef.current = {}
    setExtractionError(null)
    setRetryCount(0)
    setIsCleared(true)
    setCompletedFormData(null)
    setExtractionCount(0)

    // ✅ Also reset the store (clears locked fields, user edits, etc.)
    resetStore()
  }, [stop, resetStore])

  const cleanup = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    if (streamThrottleRef.current) {
      clearTimeout(streamThrottleRef.current)
      streamThrottleRef.current = null
    }
    stop()
  }, [stop])

  return {
    formData: isCleared ? null : completedFormData,
    streamingFormData: isCleared ? null : object,
    extractionCount,
    isExtracting: isLoading,
    extractFields,
    error: extractionError || error?.message,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    overallConfidence: isCleared
      ? 0
      : ((completedFormData as any)?.confidence?.overall ?? 0),
    clearError,
    reset,
    cleanup,
    canRetry: retryCount < MAX_RETRIES,
  }
}
