import { create } from 'zustand';
import type { BillboardFormData } from '@/hooks/useBillboardFormExtraction';

// Re-export the type so other files can import from store
export type { BillboardFormData } from '@/hooks/useBillboardFormExtraction';

// LeadSentiment type (from your types/sales-call)
export type LeadSentiment = "Availer" | "Panel Requester" | "Tire Kicker" | null;

export interface ContactData {
  id: string;
  name: string;
  position: string;
  phone: string;
  email: string;
  decisionMaker: string;
  sendOver: ("Avails" | "Panel Info" | "Planning Rates")[];
}

export interface MarketData {
  targetCity: string;
  state: string;
  targetArea: string;
  startMonth: string;
  campaignLength: string[];
  boardType: string;
}

type FormFieldKey = keyof BillboardFormData;

// Fields that should ALWAYS update from AI (not locked)
const ALWAYS_UPDATE_FIELDS: FormFieldKey[] = ['notes'];

// Fields to skip entirely (metadata, not user-facing)
const SKIP_FIELDS: string[] = ['confidence'];

interface FormStore {
  // ✅ Form field values
  fields: BillboardFormData;
  
  // ✅ Track which fields were edited by user (won't be overwritten by AI)
  userEditedFields: Set<string>;
  
  // ✅ Track which fields are locked (filled by AI or user - won't be overwritten)
  lockedFields: Set<string>;
  
  // ✅ Track which fields just changed (for animations/effects)
  recentlyChangedFields: Set<string>;
  
  // ✅ Additional contacts and markets
  additionalContacts: ContactData[];
  additionalMarkets: MarketData[];
  
  // ✅ Active indices
  activeContactIndex: number;
  activeMarketIndex: number;
  
  // ✅ Confirmations (for button groups)
  confirmedLeadType: string | null;
  confirmedDecisionMakers: { [contactIndex: number]: string | null };
  confirmedBoardTypes: { [marketIndex: number]: string | null };
  confirmedDurations: { [marketIndex: number]: string[] };
  confirmedSendOver: { [contactIndex: number]: string[] };
  
  // ✅ Twilio state
  twilioPhone: string;
  twilioPhonePreFilled: boolean;
  
  // ✅ Phone verification (AI extracted phone matches Twilio caller ID)
  phoneVerified: boolean;
  
  // ✅ Ballpark
  ballpark: string;
  
  // ============================================================================
  // ACTIONS
  // ============================================================================
  
  // Update a single field (user action) - locks the field
  updateField: (field: FormFieldKey, value: string | boolean | string[] | null) => void;
  
  // Update from AI extraction (only updates unlocked fields, except notes)
  updateFromAI: (data: Partial<BillboardFormData>) => void;
  
  // Get current form data snapshot
  getFormData: () => BillboardFormData;
  
  // Lock/unlock field management
  lockField: (field: FormFieldKey) => void;
  unlockField: (field: FormFieldKey) => void;
  isFieldLocked: (field: FormFieldKey) => boolean;
  
  // Contact management
  addContact: () => void;
  removeContact: (index: number) => void;
  updateContactField: (contactIndex: number, field: keyof ContactData, value: string | string[]) => void;
  setActiveContactIndex: (index: number) => void;
  
  // Market management
  addMarket: () => void;
  removeMarket: (index: number) => void;
  updateMarketField: (marketIndex: number, field: keyof MarketData, value: string | string[]) => void;
  setActiveMarketIndex: (index: number) => void;
  
  // Confirmation actions
  setConfirmedLeadType: (value: string | null) => void;
  setConfirmedDecisionMaker: (contactIndex: number, value: string | null) => void;
  setConfirmedBoardType: (marketIndex: number, value: string | null) => void;
  setConfirmedDuration: (marketIndex: number, values: string[]) => void;
  setConfirmedSendOver: (contactIndex: number, values: string[]) => void;
  
  // Twilio actions
  setTwilioPhone: (phone: string) => void;
  setTwilioPhonePreFilled: (value: boolean) => void;
  prefillPhoneFromTwilio: (phone: string) => void;
  
  // Phone verification
  setPhoneVerified: (verified: boolean) => void;
  
  // Ballpark
  setBallpark: (value: string) => void;
  
  // Reset everything
  reset: () => void;
  
  // Clear recently changed (call after animation completes)
  clearRecentlyChanged: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const INITIAL_FIELDS: BillboardFormData = {
  // Required fields
  leadType: null,
  name: null,
  phone: null,
  email: null,
  website: null,
  decisionMaker: null,
  sendOver: null,
  billboardPurpose: null,
  targetArea: null,
  startMonth: null,
  campaignLength: null,
  hasMediaExperience: null,
  yearsInBusiness: null,
  notes: null,
  // Optional fields
  typeName: null,
  businessName: null,
  entityName: null,
  position: null,
  billboardsBeforeYN: null,
  billboardsBeforeDetails: null,
  accomplishDetails: null,
  targetAudience: null,
  targetCity: null,
  state: null,
  boardType: null,
};

// ============================================================================
// HELPER: Check if a value is "empty" (null, undefined, empty string, empty array)
// ============================================================================

const isEmptyValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
};

// ============================================================================
// STORE
// ============================================================================

export const useFormStore = create<FormStore>()((set, get) => ({
    // Initial state
    fields: { ...INITIAL_FIELDS },
    userEditedFields: new Set<string>(),
    lockedFields: new Set<string>(),
    recentlyChangedFields: new Set<string>(),
    additionalContacts: [],
    additionalMarkets: [],
    activeContactIndex: 0,
    activeMarketIndex: 0,
    confirmedLeadType: null,
    confirmedDecisionMakers: {},
    confirmedBoardTypes: {},
    confirmedDurations: {},
    confirmedSendOver: {},
    twilioPhone: '',
    twilioPhonePreFilled: false,
    phoneVerified: false,
    ballpark: '',

    // ✅ Update single field (user action) - marks field as user-edited AND locked
    updateField: (field, value) => {
      set((state) => {
        const newUserEditedFields = new Set(state.userEditedFields).add(field);
        const newLockedFields = new Set(state.lockedFields).add(field);
        
        return {
          fields: { ...state.fields, [field]: value },
          userEditedFields: newUserEditedFields,
          lockedFields: newLockedFields,
          recentlyChangedFields: new Set([field]),
        };
      });
    },

    // ✅ Update from AI - SMART MERGE with locking behavior
    // - Skips user-edited fields (user always wins)
    // - Skips locked fields (already filled by AI)
    // - EXCEPT for 'notes' which always updates
    // - Locks fields after filling them
    updateFromAI: (data) => {
      const { userEditedFields, lockedFields, fields, twilioPhone, twilioPhonePreFilled } = get();
      const newFields = { ...fields };
      const changed = new Set<string>();
      const newLockedFields = new Set(lockedFields);

      // Helper to normalize phone numbers for comparison (last 10 digits only)
      const normalizePhone = (phone: string | null | undefined): string => 
        phone?.replace(/\D/g, '').slice(-10) || '';

      for (const [key, value] of Object.entries(data)) {
        const fieldKey = key as FormFieldKey;
        
        // Skip metadata fields
        if (SKIP_FIELDS.includes(key)) continue;
        
        // Skip if value is empty
        if (isEmptyValue(value)) continue;

        // ✅ ALWAYS UPDATE these fields (like notes) - never lock them
        if (ALWAYS_UPDATE_FIELDS.includes(fieldKey)) {
          if (value !== null && value !== undefined) {
            (newFields as Record<string, unknown>)[key] = value;
            changed.add(key);
          }
          continue;
        }
        
        // ✅ Skip if user has edited this field (user always wins)
        if (userEditedFields.has(key)) {
          console.log(`🔒 Skipping ${key}: user-edited`);
          continue;
        }
        
        // ✅ Skip if field is already locked (already filled by AI previously)
        if (lockedFields.has(key)) {
          console.log(`🔒 Skipping ${key}: already locked`);
          continue;
        }

        // =========================================================================
        // PHONE FIELD SPECIAL HANDLING
        // =========================================================================
        if (key === 'phone') {
          // If Twilio phone is prefilled, NEVER overwrite it with AI extraction
          if (twilioPhonePreFilled) {
            // But still check for verification if AI extracted a valid phone
            if (value && typeof value === 'string' && value.trim()) {
              const extractedNormalized = normalizePhone(value);
              const twilioNormalized = normalizePhone(twilioPhone);
              
              if (twilioNormalized && extractedNormalized) {
                if (extractedNormalized === twilioNormalized) {
                  set({ phoneVerified: true });
                }
              }
            }
            // ALWAYS skip updating the phone field when Twilio prefilled
            continue;
          }
        }

        // ✅ Only update if current value is empty
        const currentValue = fields[fieldKey];
        if (!isEmptyValue(currentValue)) {
          console.log(`🔒 Skipping ${key}: already has value "${currentValue}"`);
          continue;
        }

        // ✅ Update the field and lock it
        console.log(`✅ Filling ${key} with:`, value);
        (newFields as Record<string, unknown>)[key] = value;
        changed.add(key);
        newLockedFields.add(key); // Lock the field after filling
      }

      if (changed.size > 0) {
        console.log(`📝 Updated ${changed.size} fields:`, Array.from(changed));
        set({ 
          fields: newFields, 
          lockedFields: newLockedFields,
          recentlyChangedFields: changed,
        });
      } else {
        console.log('📝 No fields updated (all locked or empty values)');
      }
    },

    // ✅ Get snapshot of current form data
    getFormData: () => get().fields,

    // ✅ Lock/unlock field management
    lockField: (field) => {
      set((state) => ({
        lockedFields: new Set(state.lockedFields).add(field),
      }));
    },
    
    unlockField: (field) => {
      set((state) => {
        const newLockedFields = new Set(state.lockedFields);
        newLockedFields.delete(field);
        return { lockedFields: newLockedFields };
      });
    },
    
    isFieldLocked: (field) => {
      return get().lockedFields.has(field);
    },

    // ✅ Contact management
    addContact: () => {
      const { additionalContacts } = get();
      if (additionalContacts.length >= 1) return; // Max 1 additional
      
      const newContact: ContactData = {
        id: Date.now().toString(),
        name: '',
        position: '',
        phone: '',
        email: '',
        decisionMaker: '',
        sendOver: [],
      };
      
      set({
        additionalContacts: [...additionalContacts, newContact],
        activeContactIndex: additionalContacts.length + 1,
      });
    },

    removeContact: (index) => {
      if (index === 0) return; // Can't remove primary
      const { additionalContacts, activeContactIndex } = get();
      const additionalIndex = index - 1;
      const updated = additionalContacts.filter((_, i) => i !== additionalIndex);
      
      let newActiveIndex = activeContactIndex;
      if (activeContactIndex >= updated.length + 1) {
        newActiveIndex = updated.length;
      } else if (activeContactIndex > index) {
        newActiveIndex = activeContactIndex - 1;
      } else if (activeContactIndex === index) {
        newActiveIndex = 0;
      }
      
      set({ additionalContacts: updated, activeContactIndex: newActiveIndex });
    },

    updateContactField: (contactIndex, field, value) => {
      if (contactIndex === 0) {
        // Primary contact - update main fields
        const fieldMap: Record<string, FormFieldKey> = {
          name: 'name',
          position: 'position',
          phone: 'phone',
          email: 'email',
          decisionMaker: 'decisionMaker',
        };
        
        if (fieldMap[field]) {
          get().updateField(fieldMap[field], value as string);
        }
        
        // Handle phone special case - clear verification when manually edited
        if (field === 'phone') {
          set({ twilioPhonePreFilled: false, phoneVerified: false });
        }
      } else {
        // Additional contact
        const { additionalContacts } = get();
        const additionalIndex = contactIndex - 1;
        const updated = additionalContacts.map((contact, i) =>
          i === additionalIndex ? { ...contact, [field]: value } : contact
        );
        set({ additionalContacts: updated });
      }
    },

    setActiveContactIndex: (index) => set({ activeContactIndex: index }),

    // ✅ Market management
    addMarket: () => {
      const { additionalMarkets } = get();
      if (additionalMarkets.length >= 1) return; // Max 1 additional
      
      const newMarket: MarketData = {
        targetCity: '',
        state: '',
        targetArea: '',
        startMonth: '',
        campaignLength: [],
        boardType: '',
      };
      
      set({
        additionalMarkets: [...additionalMarkets, newMarket],
        activeMarketIndex: additionalMarkets.length + 1,
      });
    },

    removeMarket: (index) => {
      if (index === 0) return; // Can't remove primary
      const { additionalMarkets, activeMarketIndex } = get();
      const additionalIndex = index - 1;
      const updated = additionalMarkets.filter((_, i) => i !== additionalIndex);
      
      let newActiveIndex = activeMarketIndex;
      if (activeMarketIndex >= updated.length + 1) {
        newActiveIndex = updated.length;
      } else if (activeMarketIndex > index) {
        newActiveIndex = activeMarketIndex - 1;
      } else if (activeMarketIndex === index) {
        newActiveIndex = 0;
      }
      
      set({ additionalMarkets: updated, activeMarketIndex: newActiveIndex });
    },

    updateMarketField: (marketIndex, field, value) => {
      if (marketIndex === 0) {
        // Primary market - update main fields
        const fieldMap: Record<string, FormFieldKey> = {
          targetCity: 'targetCity',
          state: 'state',
          targetArea: 'targetArea',
          startMonth: 'startMonth',
          campaignLength: 'campaignLength',
          boardType: 'boardType',
        };
        
        if (fieldMap[field]) {
          get().updateField(fieldMap[field], value as string | string[]);
        }
      } else {
        // Additional market
        const { additionalMarkets } = get();
        const additionalIndex = marketIndex - 1;
        const updated = additionalMarkets.map((market, i) =>
          i === additionalIndex ? { ...market, [field]: value } : market
        );
        set({ additionalMarkets: updated });
      }
    },

    setActiveMarketIndex: (index) => set({ activeMarketIndex: index }),

    // ✅ Confirmation actions
    setConfirmedLeadType: (value) => set({ confirmedLeadType: value }),
    
    setConfirmedDecisionMaker: (contactIndex, value) => {
      set((state) => ({
        confirmedDecisionMakers: { ...state.confirmedDecisionMakers, [contactIndex]: value },
      }));
    },
    
    setConfirmedBoardType: (marketIndex, value) => {
      set((state) => ({
        confirmedBoardTypes: { ...state.confirmedBoardTypes, [marketIndex]: value },
      }));
    },
    
    setConfirmedDuration: (marketIndex, values) => {
      set((state) => ({
        confirmedDurations: { ...state.confirmedDurations, [marketIndex]: values },
      }));
    },
    
    setConfirmedSendOver: (contactIndex, values) => {
      set((state) => ({
        confirmedSendOver: { ...state.confirmedSendOver, [contactIndex]: values },
      }));
    },

    // ✅ Twilio actions
    setTwilioPhone: (phone) => set({ twilioPhone: phone }),
    setTwilioPhonePreFilled: (value) => set({ twilioPhonePreFilled: value }),
    
    prefillPhoneFromTwilio: (phone) => {
      const { fields, userEditedFields } = get();
      // Only prefill if phone hasn't been edited and is empty
      if (!userEditedFields.has('phone') && !fields.phone) {
        // Normalize: strip +1 country code and format as (XXX) XXX-XXXX
        const digits = phone.replace(/^\+1/, '').replace(/\D/g, '');
        const formatted = digits.length === 10 
          ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
          : digits; // Fallback to just digits if not 10 digits
        
        set({
          fields: { ...fields, phone: formatted },
          twilioPhone: formatted,
          twilioPhonePreFilled: true,
          phoneVerified: false, // Reset verification on new prefill
        });
      }
    },

    // ✅ Phone verification
    setPhoneVerified: (verified) => set({ phoneVerified: verified }),

    // ✅ Ballpark
    setBallpark: (value) => set({ ballpark: value }),

    // ✅ Reset everything (including locked fields)
    reset: () => {
      set({
        fields: { ...INITIAL_FIELDS },
        userEditedFields: new Set<string>(),
        lockedFields: new Set<string>(),
        recentlyChangedFields: new Set<string>(),
        additionalContacts: [],
        additionalMarkets: [],
        activeContactIndex: 0,
        activeMarketIndex: 0,
        confirmedLeadType: null,
        confirmedDecisionMakers: {},
        confirmedBoardTypes: {},
        confirmedDurations: {},
        confirmedSendOver: {},
        twilioPhone: '',
        twilioPhonePreFilled: false,
        phoneVerified: false,
        ballpark: '',
      });
    },

    // ✅ Clear recently changed fields
    clearRecentlyChanged: () => {
      set({ recentlyChangedFields: new Set<string>() });
    },
  }));

// ============================================================================
// SELECTORS - Use these to subscribe to specific fields only
// ============================================================================

// Select a single field value
export const selectField = <K extends FormFieldKey>(field: K) => 
  (state: FormStore) => state.fields[field];

// Select multiple fields
export const selectFields = <K extends FormFieldKey>(fields: K[]) =>
  (state: FormStore) => {
    const result: Partial<BillboardFormData> = {};
    for (const field of fields) {
      result[field] = state.fields[field];
    }
    return result as Pick<BillboardFormData, K>;
  };

// Check if a field was recently changed
export const selectIsRecentlyChanged = (field: string) =>
  (state: FormStore) => state.recentlyChangedFields.has(field);

// Phone verification selector
export const selectPhoneVerified = (state: FormStore) => state.phoneVerified;

// ✅ Check if a field is locked (by user edit or AI fill)
export const selectIsFieldLocked = (field: string) =>
  (state: FormStore) => state.lockedFields.has(field);

// ✅ Check if a field was edited by user specifically
export const selectIsUserEdited = (field: string) =>
  (state: FormStore) => state.userEditedFields.has(field);

// Select current market data
export const selectCurrentMarket = (state: FormStore) => {
  if (state.activeMarketIndex === 0) {
    return {
      targetCity: state.fields.targetCity ?? '',
      state: state.fields.state ?? '',
      targetArea: state.fields.targetArea ?? '',
      startMonth: state.fields.startMonth ?? '',
      campaignLength: Array.isArray(state.fields.campaignLength) 
        ? state.fields.campaignLength 
        : state.fields.campaignLength 
          ? [state.fields.campaignLength] 
          : [],
      boardType: state.fields.boardType ?? '',
    };
  }
  return state.additionalMarkets[state.activeMarketIndex - 1] ?? {
    targetCity: '',
    state: '',
    targetArea: '',
    startMonth: '',
    campaignLength: [],
    boardType: '',
  };
};

// Select current contact data
export const selectCurrentContact = (state: FormStore) => {
  if (state.activeContactIndex === 0) {
    return {
      id: 'primary',
      name: state.fields.name ?? '',
      position: state.fields.position ?? '',
      phone: state.fields.phone ?? '',
      email: state.fields.email ?? '',
      decisionMaker: state.fields.decisionMaker ?? '',
      sendOver: (Array.isArray(state.fields.sendOver) ? state.fields.sendOver : []).filter((s): s is "Avails" | "Panel Info" | "Planning Rates" => s !== undefined),
    };
  }
  return state.additionalContacts[state.activeContactIndex - 1] ?? {
    id: '',
    name: '',
    position: '',
    phone: '',
    email: '',
    decisionMaker: '',
    sendOver: [],
  };
};