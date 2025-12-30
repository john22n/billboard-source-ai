// hooks/useFormFieldStore.ts
"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import type { BillboardFormData } from "@/hooks/useBillboardFormExtraction";

type FieldValue = string | boolean | string[] | null;
type Listener = () => void;

// ✅ Create a simple store that allows subscribing to individual fields
class FormFieldStore {
  private data: BillboardFormData;
  private listeners: Map<string, Set<Listener>> = new Map();
  private globalListeners: Set<Listener> = new Set();
  private userEditedFields: Set<string> = new Set();

  constructor(initialData: BillboardFormData) {
    this.data = { ...initialData };
  }

  // Get a specific field value
  getField<K extends keyof BillboardFormData>(field: K): BillboardFormData[K] {
    return this.data[field];
  }

  // Get all data (for submission)
  getAllData(): BillboardFormData {
    return { ...this.data };
  }

  // Check if field was manually edited
  isUserEdited(field: string): boolean {
    return this.userEditedFields.has(field);
  }

  // Get all user-edited fields
  getUserEditedFields(): Set<string> {
    return new Set(this.userEditedFields);
  }

  // Set a specific field - only notifies listeners for THAT field
  setField<K extends keyof BillboardFormData>(
    field: K, 
    value: BillboardFormData[K],
    isUserEdit: boolean = false
  ): void {
    // Skip if value hasn't changed
    if (this.data[field] === value) return;
    
    // If this is a user edit, or field hasn't been user-edited yet, update it
    if (isUserEdit || !this.userEditedFields.has(field)) {
      this.data[field] = value;
      
      if (isUserEdit) {
        this.userEditedFields.add(field);
      }

      // Only notify listeners for THIS specific field
      this.notifyField(field);
    }
  }

  // Update from AI - only updates fields that haven't been manually edited
  updateFromAI(aiData: Partial<BillboardFormData>): string[] {
    const updatedFields: string[] = [];
    
    for (const [key, value] of Object.entries(aiData)) {
      const field = key as keyof BillboardFormData;
      
      // Skip if user has manually edited this field
      if (this.userEditedFields.has(field)) continue;
      
      // Skip if value is undefined or same as current
      if (value === undefined) continue;
      if (this.deepEqual(this.data[field], value)) continue;
      
      // Update the field - cast through unknown to satisfy TypeScript
      (this.data as unknown as Record<string, unknown>)[field] = value;
      updatedFields.push(field);
      
      // Notify only this field's listeners
      this.notifyField(field);
    }
    
    if (updatedFields.length > 0) {
      console.log("🔄 AI updated fields:", updatedFields);
    }
    
    return updatedFields;
  }

  // Subscribe to a specific field
  subscribeToField(field: string, listener: Listener): () => void {
    if (!this.listeners.has(field)) {
      this.listeners.set(field, new Set());
    }
    this.listeners.get(field)!.add(listener);
    
    return () => {
      this.listeners.get(field)?.delete(listener);
    };
  }

  // Subscribe to all changes (for things like form submission)
  subscribeToAll(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  // Reset the store
  reset(initialData: BillboardFormData): void {
    this.data = { ...initialData };
    this.userEditedFields.clear();
    
    // Notify all field listeners
    this.listeners.forEach((listeners) => {
      listeners.forEach(listener => listener());
    });
    this.globalListeners.forEach(listener => listener());
  }

  private notifyField(field: string): void {
    // Notify field-specific listeners
    this.listeners.get(field)?.forEach(listener => listener());
    // Also notify global listeners
    this.globalListeners.forEach(listener => listener());
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (a === undefined || b === undefined) return a === b;
    
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, idx) => this.deepEqual(val, b[idx]));
    }
    
    if (typeof a === 'object' && typeof b === 'object') {
      const aKeys = Object.keys(a as object);
      const bKeys = Object.keys(b as object);
      if (aKeys.length !== bKeys.length) return false;
      return aKeys.every(key => 
        this.deepEqual(
          (a as Record<string, unknown>)[key], 
          (b as Record<string, unknown>)[key]
        )
      );
    }
    
    return false;
  }
}

// ✅ Initial empty form data
const INITIAL_FORM_DATA: BillboardFormData = {
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

// ✅ Hook to create and manage the form store
export function useFormFieldStore() {
  const storeRef = useRef<FormFieldStore | null>(null);
  
  if (!storeRef.current) {
    storeRef.current = new FormFieldStore(INITIAL_FORM_DATA);
  }
  
  const store = storeRef.current;

  // Reset the store
  const reset = useCallback(() => {
    store.reset(INITIAL_FORM_DATA);
  }, [store]);

  // Update from AI extraction
  const updateFromAI = useCallback((aiData: Partial<BillboardFormData>) => {
    return store.updateFromAI(aiData);
  }, [store]);

  // Get all data for submission
  const getAllData = useCallback(() => {
    return store.getAllData();
  }, [store]);

  return {
    store,
    reset,
    updateFromAI,
    getAllData,
  };
}

// ✅ Hook to subscribe to a SINGLE field - component only re-renders when THIS field changes
export function useFormField<K extends keyof BillboardFormData>(
  store: FormFieldStore,
  field: K
): [BillboardFormData[K], (value: BillboardFormData[K]) => void, boolean] {
  
  // Subscribe to just this field
  const value = useSyncExternalStore(
    useCallback((onStoreChange) => store.subscribeToField(field, onStoreChange), [store, field]),
    useCallback(() => store.getField(field), [store, field]),
    useCallback(() => store.getField(field), [store, field])
  );

  // Setter that marks as user-edited
  const setValue = useCallback((newValue: BillboardFormData[K]) => {
    store.setField(field, newValue, true);
  }, [store, field]);

  // Check if user has edited this field
  const isUserEdited = store.isUserEdited(field);

  return [value, setValue, isUserEdited];
}

// ✅ Hook to get all form data (for submission) - only use where you need ALL data
export function useAllFormData(store: FormFieldStore): BillboardFormData {
  return useSyncExternalStore(
    useCallback((onStoreChange) => store.subscribeToAll(onStoreChange), [store]),
    useCallback(() => store.getAllData(), [store]),
    useCallback(() => store.getAllData(), [store])
  );
}

export { FormFieldStore, INITIAL_FORM_DATA };
export type { FieldValue };