"use client";

import { memo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormStore, selectField, type BillboardFormData } from "@/stores/formStore";

type FormFieldKey = keyof BillboardFormData;

// ============================================================================
// HELPER: Get input styling based on value
// ============================================================================

const getInputClass = (value: string | null | undefined, baseClass: string = "") => {
  if (value && value.trim() !== "") {
    return `${baseClass} bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500`;
  }
  return `${baseClass} bg-red-100`;
};

// ============================================================================
// FIELD INPUT - Subscribes to ONE field only
// ============================================================================

interface FieldInputProps {
  field: FormFieldKey;
  placeholder?: string;
  className?: string;
  baseClassName?: string;
}

export const FieldInput = memo(function FieldInput({
  field,
  placeholder,
  className = "",
  baseClassName = "h-10 text-sm border-2 border-black rounded transition-colors"
}: FieldInputProps) {
  // ✅ Subscribe to ONLY this field
  const rawValue = useFormStore(selectField(field));
  const updateField = useFormStore((s) => s.updateField);

  // 🔍 Performance monitoring (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log(`🔄 Re-render: FieldInput[${field}]`);
  }

  // Convert boolean to string for display (for hasMediaExperience)
  const value = typeof rawValue === 'boolean'
    ? (rawValue ? 'Yes' : 'No')
    : (rawValue as string | null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateField(field, e.target.value);
  }, [field, updateField]);

  const inputClass = getInputClass(value, baseClassName);

  return (
    <Input
      value={value ?? ""}
      onChange={handleChange}
      placeholder={placeholder}
      className={`${inputClass} ${className}`}
    />
  );
});

// ============================================================================
// FIELD TEXTAREA - Subscribes to ONE field only
// ============================================================================

interface FieldTextareaProps {
  field: FormFieldKey;
  className?: string;
  baseClassName?: string;
}

export const FieldTextarea = memo(function FieldTextarea({ 
  field,
  className = "",
  baseClassName = "text-sm resize-none border-2 border-black rounded transition-colors"
}: FieldTextareaProps) {
  const value = useFormStore(selectField(field)) as string | null;
  const updateField = useFormStore((s) => s.updateField);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateField(field, e.target.value);
  }, [field, updateField]);

  const inputClass = getInputClass(value, baseClassName);

  return (
    <Textarea
      value={value ?? ""}
      onChange={handleChange}
      className={`${inputClass} ${className}`}
    />
  );
});

// ============================================================================
// PHONE INPUT - Special handling for Twilio pre-fill and verification
// ============================================================================

export const PhoneInput = memo(function PhoneInput({ 
  className = "",
  baseClassName = "h-10 text-sm border-2 rounded transition-all"
}: { className?: string; baseClassName?: string }) {
  const phone = useFormStore(selectField('phone'));
  const twilioPhonePreFilled = useFormStore((s) => s.twilioPhonePreFilled);
  const phoneVerified = useFormStore((s) => s.phoneVerified);
  const userEditedFields = useFormStore((s) => s.userEditedFields);
  const updateField = useFormStore((s) => s.updateField);
  const setTwilioPhonePreFilled = useFormStore((s) => s.setTwilioPhonePreFilled);
  const setPhoneVerified = useFormStore((s) => s.setPhoneVerified);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTwilioPhonePreFilled(false);
    setPhoneVerified(false);
    updateField('phone', e.target.value);
  }, [updateField, setTwilioPhonePreFilled, setPhoneVerified]);

  // Determine phone input color and styling
  // Priority: Verified (bright green with glow) > Manual edit (green) > Twilio pre-fill (yellow) > Empty (red)
  let colorClass = 'bg-red-100 border-black';
  let wrapperClass = '';
  
  if (phone && phone.trim() !== "") {
    if (phoneVerified) {
      // ✅ VERIFIED: AI extracted phone matches Twilio caller ID
      colorClass = 'bg-green-100 border-green-600 shadow-lg ring-2 ring-green-400 focus:border-green-700 focus:ring-green-500 focus:ring-offset-1';
      wrapperClass = 'relative';
    } else if (twilioPhonePreFilled) {
      // ⏳ PENDING: Twilio pre-filled, waiting for verification
      colorClass = 'bg-yellow-50 border-yellow-500 focus:border-yellow-600 focus:ring-yellow-400';
    } else if (userEditedFields.has('phone')) {
      // ✏️ MANUAL: User typed this in
      colorClass = 'bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500';
    } else {
      // Default filled state
      colorClass = 'bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500';
    }
  }

  return (
    <div className={wrapperClass}>
      <Input
        value={phone ?? ""}
        onChange={handleChange}
        className={`${baseClassName} ${colorClass} ${className}`}
      />
      {phoneVerified && (
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
          <span className="text-xs font-semibold text-green-700">✓</span>
        </div>
      )}
    </div>
  );
});
// ============================================================================
// CONTACT FIELD INPUT - For additional contacts
// ============================================================================

interface ContactFieldInputProps {
  contactIndex: number;
  field: 'name' | 'position' | 'phone' | 'email';
  className?: string;
}

export const ContactFieldInput = memo(function ContactFieldInput({
  contactIndex,
  field,
  className = ""
}: ContactFieldInputProps) {
  // For primary contact (index 0), use main form fields
  // For additional contacts, use additionalContacts array
  const value = useFormStore((s) => {
    if (contactIndex === 0) {
      return s.fields[field] ?? '';
    }
    const contact = s.additionalContacts[contactIndex - 1];
    return contact ? contact[field] : '';
  });
  
  const updateContactField = useFormStore((s) => s.updateContactField);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateContactField(contactIndex, field, e.target.value);
  }, [contactIndex, field, updateContactField]);

  const inputClass = getInputClass(value, "h-10 text-sm border-2 border-black rounded transition-colors");

  // Special case: primary contact phone uses PhoneInput
  if (contactIndex === 0 && field === 'phone') {
    return <PhoneInput className={className} />;
  }

  return (
    <Input
      value={value}
      onChange={handleChange}
      className={`${inputClass} ${className}`}
    />
  );
});

// ============================================================================
// MARKET FIELD INPUT - For market location fields
// ============================================================================

interface MarketFieldInputProps {
  marketIndex: number;
  field: 'targetCity' | 'state' | 'targetArea' | 'startMonth';
  className?: string;
  placeholder?: string;
}

export const MarketFieldInput = memo(function MarketFieldInput({
  marketIndex,
  field,
  className = "",
  placeholder
}: MarketFieldInputProps) {
  const value = useFormStore((s) => {
    if (marketIndex === 0) {
      return s.fields[field] ?? '';
    }
    const market = s.additionalMarkets[marketIndex - 1];
    return market ? market[field] : '';
  });
  
  const updateMarketField = useFormStore((s) => s.updateMarketField);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateMarketField(marketIndex, field, e.target.value);
  }, [marketIndex, field, updateMarketField]);

  const inputClass = getInputClass(value, "h-10 text-sm border-2 border-black rounded transition-colors");

  return (
    <Input
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      className={`${inputClass} ${className}`}
    />
  );
});

// ============================================================================
// MARKET FIELD TEXTAREA - For target area
// ============================================================================

interface MarketFieldTextareaProps {
  marketIndex: number;
  className?: string;
}

export const MarketFieldTextarea = memo(function MarketFieldTextarea({
  marketIndex,
  className = ""
}: MarketFieldTextareaProps) {
  const value = useFormStore((s) => {
    if (marketIndex === 0) {
      return s.fields.targetArea ?? '';
    }
    const market = s.additionalMarkets[marketIndex - 1];
    return market ? market.targetArea : '';
  });
  
  const updateMarketField = useFormStore((s) => s.updateMarketField);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateMarketField(marketIndex, 'targetArea', e.target.value);
  }, [marketIndex, updateMarketField]);

  const inputClass = getInputClass(value, "text-sm resize-none border-2 border-black rounded transition-colors");

  return (
    <Textarea
      value={value}
      onChange={handleChange}
      className={`${inputClass} ${className}`}
    />
  );
});

// ============================================================================
// BUTTON GROUP - For single-select buttons (Lead Type, Board Type, Decision Maker)
// ============================================================================

interface ButtonOption {
  value: string;
  label: string;
}

interface ButtonGroupProps {
  options: ButtonOption[];
  field: FormFieldKey;
  confirmedValue: string | null;
  onConfirm: (value: string) => void;
  className?: string;
  buttonClassName?: string;
}

export const ButtonGroup = memo(function ButtonGroup({
  options,
  field,
  confirmedValue,
  onConfirm,
  className = "",
  buttonClassName = "px-3.5 py-2 text-md"
}: ButtonGroupProps) {
  const aiValue = useFormStore(selectField(field)) as string | null;
  const updateField = useFormStore((s) => s.updateField);

  const handleClick = useCallback((value: string) => {
    updateField(field, value);
    onConfirm(value);
  }, [field, updateField, onConfirm]);

  return (
    <div className={`flex gap-3 ${className}`}>
      {options.map((option) => {
        let bgClass = 'bg-red-100 border-black';
        if (confirmedValue === option.value) {
          bgClass = 'bg-green-100 border-green-500';
        } else if (aiValue === option.value && !confirmedValue) {
          bgClass = 'bg-yellow-100 border-yellow-500';
        }

        return (
          <button
            key={option.value}
            onClick={() => handleClick(option.value)}
            className={`font-bold border-2 rounded transition-colors ${bgClass} ${buttonClassName}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
});

// ============================================================================
// MULTI-SELECT BUTTON GROUP - For Duration and Send Over
// ============================================================================

interface MultiSelectButtonGroupProps {
  options: ButtonOption[];
  field: FormFieldKey;
  marketOrContactIndex: number;
  confirmedSelections: string[];
  onToggle: (value: string, newSelections: string[]) => void;
  className?: string;
  buttonClassName?: string;
  showSubtext?: boolean;
}

export const MultiSelectButtonGroup = memo(function MultiSelectButtonGroup({
  options,
  field,
  marketOrContactIndex,
  confirmedSelections,
  onToggle,
  className = "",
  buttonClassName = "px-2.5 py-1.5 text-sm",
  showSubtext = false
}: MultiSelectButtonGroupProps) {
  // ✅ Fix: Get raw value, handle array creation outside selector
  const fieldValueRaw = useFormStore((s) => marketOrContactIndex === 0 ? s.fields[field] : null);
  const aiSuggestions = (() => {
    if (marketOrContactIndex !== 0 || !fieldValueRaw) return [];
    if (Array.isArray(fieldValueRaw)) return fieldValueRaw.flat() as string[];
    return [fieldValueRaw];
  })();

  const updateField = useFormStore((s) => s.updateField);

  const handleClick = useCallback((value: string) => {
    const newSelections = confirmedSelections.includes(value)
      ? confirmedSelections.filter(v => v !== value)
      : [...confirmedSelections, value];
    
    // Update the main form field if primary market/contact
    if (marketOrContactIndex === 0) {
      updateField(field, newSelections);
    }
    
    onToggle(value, newSelections);
  }, [confirmedSelections, marketOrContactIndex, field, updateField, onToggle]);

  const subtexts: Record<string, string> = {
    "1 Mo": "(1p)",
    "3 Mo": "(3p)",
    "6 Mo": "(6p)",
    "12 Mo": "(13p)",
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      {options.map((option) => {
        const isConfirmed = confirmedSelections.includes(option.value);
        const isAISuggested = aiSuggestions.includes(option.value);
        
        let bgClass = 'bg-red-100 border-black';
        if (isConfirmed) {
          bgClass = 'bg-green-100 border-green-500';
        } else if (isAISuggested && !isConfirmed) {
          bgClass = 'bg-yellow-100 border-yellow-500';
        }

        return (
          <div key={option.value} className="flex flex-col items-center">
            <button
              onClick={() => handleClick(option.value)}
              className={`font-bold border-2 rounded transition-colors ${bgClass} ${buttonClassName}`}
            >
              {option.label}
            </button>
            {showSubtext && subtexts[option.value] && (
              <span className="text-[10px] text-gray-500 font-normal">
                {subtexts[option.value]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

// ============================================================================
// DECISION MAKER BUTTON GROUP - For contacts
// ============================================================================

interface DecisionMakerButtonGroupProps {
  contactIndex: number;
  className?: string;
}

export const DecisionMakerButtonGroup = memo(function DecisionMakerButtonGroup({
  contactIndex,
  className = ""
}: DecisionMakerButtonGroupProps) {
  const confirmedValue = useFormStore((s) => s.confirmedDecisionMakers[contactIndex] ?? null);
  const setConfirmedDecisionMaker = useFormStore((s) => s.setConfirmedDecisionMaker);
  const updateContactField = useFormStore((s) => s.updateContactField);
  
  // Get AI value for primary contact
  const aiValue = useFormStore((s) => {
    if (contactIndex === 0) return s.fields.decisionMaker;
    const contact = s.additionalContacts[contactIndex - 1];
    return contact?.decisionMaker ?? null;
  });

  const options = [
    { value: "alone", label: "You Alone" },
    { value: "boss", label: "My Boss" },
    { value: "partners", label: "Partners" },
    { value: "committee", label: "Committee" },
  ];

  const handleClick = useCallback((value: string) => {
    updateContactField(contactIndex, 'decisionMaker', value);
    setConfirmedDecisionMaker(contactIndex, value);
  }, [contactIndex, updateContactField, setConfirmedDecisionMaker]);

  return (
    <div className={`flex gap-3 ${className}`}>
      {options.map((option) => {
        let bgClass = 'bg-red-100 border-black';
        if (confirmedValue === option.value) {
          bgClass = 'bg-green-100 border-green-500';
        } else if (aiValue === option.value && !confirmedValue) {
          bgClass = 'bg-yellow-100 border-yellow-500';
        }

        return (
          <button
            key={option.value}
            onClick={() => handleClick(option.value)}
            className={`font-bold border-2 rounded transition-colors px-3.5 py-2 text-md ${bgClass}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
});

// ============================================================================
// BOARD TYPE BUTTON GROUP - For markets
// ============================================================================

interface BoardTypeButtonGroupProps {
  marketIndex: number;
  className?: string;
}

export const BoardTypeButtonGroup = memo(function BoardTypeButtonGroup({
  marketIndex,
  className = ""
}: BoardTypeButtonGroupProps) {
  const confirmedValue = useFormStore((s) => s.confirmedBoardTypes[marketIndex] ?? null);
  const setConfirmedBoardType = useFormStore((s) => s.setConfirmedBoardType);
  const updateMarketField = useFormStore((s) => s.updateMarketField);
  
  const aiValue = useFormStore((s) => {
    if (marketIndex === 0) return s.fields.boardType;
    const market = s.additionalMarkets[marketIndex - 1];
    return market?.boardType ?? null;
  });

  const options = [
    { value: "Static", label: "Static" },
    { value: "Digital", label: "Digital" },
    { value: "Both", label: "Both" },
  ];

  const handleClick = useCallback((value: string) => {
    updateMarketField(marketIndex, 'boardType', value);
    setConfirmedBoardType(marketIndex, value);
  }, [marketIndex, updateMarketField, setConfirmedBoardType]);

  return (
    <div className={`flex gap-1.5 ${className}`}>
      {options.map((option) => {
        let bgClass = 'bg-red-100 border-black';
        if (confirmedValue === option.value) {
          bgClass = 'bg-green-100 border-green-500';
        } else if (aiValue === option.value && !confirmedValue) {
          bgClass = 'bg-yellow-100 border-yellow-500';
        }

        return (
          <button
            key={option.value}
            onClick={() => handleClick(option.value)}
            className={`font-bold border-2 rounded transition-colors px-2.5 py-1.5 text-md xl:text-sm flex-1 ${bgClass}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
});

// ============================================================================
// DURATION BUTTON GROUP - For markets (multi-select)
// ============================================================================

interface DurationButtonGroupProps {
  marketIndex: number;
  className?: string;
}

export const DurationButtonGroup = memo(function DurationButtonGroup({
  marketIndex,
  className = ""
}: DurationButtonGroupProps) {
  // ✅ Fix: Handle fallback outside selector to avoid new array reference
  const confirmedSelectionsRaw = useFormStore((s) => s.confirmedDurations[marketIndex]);
  const confirmedSelections = confirmedSelectionsRaw ?? [];

  const setConfirmedDuration = useFormStore((s) => s.setConfirmedDuration);
  const updateMarketField = useFormStore((s) => s.updateMarketField);

  // ✅ Fix: Get raw value, handle array creation outside
  const campaignLengthRaw = useFormStore((s) => marketIndex === 0 ? s.fields.campaignLength : null);
  const aiSuggestions = (() => {
    if (marketIndex !== 0 || !campaignLengthRaw) return [];
    if (Array.isArray(campaignLengthRaw)) return campaignLengthRaw.flat() as string[];
    return [campaignLengthRaw];
  })();

  const options = [
    { value: "1 Mo", label: "1 Mo" },
    { value: "3 Mo", label: "3 Mo" },
    { value: "6 Mo", label: "6 Mo" },
    { value: "12 Mo", label: "1 Yr" },
    { value: "TBD", label: "TBD" },
  ];

  const subtexts: Record<string, string> = {
    "1 Mo": "(1p)",
    "3 Mo": "(3p)",
    "6 Mo": "(6p)",
    "12 Mo": "(13p)",
  };

  const handleClick = useCallback((value: string) => {
    const newSelections = confirmedSelections.includes(value)
      ? confirmedSelections.filter(v => v !== value)
      : [...confirmedSelections, value];
    
    setConfirmedDuration(marketIndex, newSelections);
    
    if (marketIndex === 0) {
      updateMarketField(marketIndex, 'campaignLength', newSelections);
    }
  }, [confirmedSelections, marketIndex, setConfirmedDuration, updateMarketField]);

  return (
    <div className={`flex gap-2 ${className}`}>
      {options.map((option) => {
        const isConfirmed = confirmedSelections.includes(option.value);
        const isAISuggested = aiSuggestions.includes(option.value);
        
        let bgClass = 'bg-red-100 border-black';
        if (isConfirmed) {
          bgClass = 'bg-green-100 border-green-500';
        } else if (isAISuggested && !isConfirmed) {
          bgClass = 'bg-yellow-100 border-yellow-500';
        }

        return (
          <div key={option.value} className="flex flex-col items-center">
            <button
              onClick={() => handleClick(option.value)}
              className={`font-bold border-2 rounded transition-colors px-2.5 py-1.5 text-sm text-nowrap lg:text-xs ${bgClass}`}
            >
              {option.label}
            </button>
            {subtexts[option.value] && (
              <span className="text-[10px] text-gray-500 font-normal">
                {subtexts[option.value]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

// ============================================================================
// SEND OVER BUTTON GROUP - For contacts (multi-select)
// ============================================================================

interface SendOverButtonGroupProps {
  contactIndex: number;
  className?: string;
}

export const SendOverButtonGroup = memo(function SendOverButtonGroup({
  contactIndex,
  className = ""
}: SendOverButtonGroupProps) {
  // ✅ Fix: Handle fallback outside selector to avoid new array reference
  const confirmedSelectionsRaw = useFormStore((s) => s.confirmedSendOver[contactIndex]);
  const confirmedSelections = confirmedSelectionsRaw ?? [];

  const setConfirmedSendOver = useFormStore((s) => s.setConfirmedSendOver);
  const updateField = useFormStore((s) => s.updateField);

  // ✅ Fix: Get raw value, handle array operations outside
  const sendOverRaw = useFormStore((s) => contactIndex === 0 ? s.fields.sendOver : null);
  const aiSuggestions = (() => {
    if (contactIndex !== 0 || !sendOverRaw) return [];
    return sendOverRaw.filter((s): s is "Avails" | "Panel Info" | "Planning Rates" => s !== undefined);
  })();

  const options = [
    { value: "Avails", label: "Avails" },
    { value: "Panel Info", label: "Panel Info" },
    { value: "Planning Rates", label: "Planning Rates" },
  ];

  const handleClick = useCallback((value: string) => {
    const newSelections = confirmedSelections.includes(value)
      ? confirmedSelections.filter(v => v !== value)
      : [...confirmedSelections, value];
    
    setConfirmedSendOver(contactIndex, newSelections);
    
    if (contactIndex === 0) {
      updateField('sendOver', newSelections as ("Avails" | "Panel Info" | "Planning Rates")[]);
    }
  }, [confirmedSelections, contactIndex, setConfirmedSendOver, updateField]);

  return (
    <div className={`flex gap-3 ${className}`}>
      {options.map((option) => {
        const isConfirmed = confirmedSelections.includes(option.value);
        const isAISuggested = aiSuggestions.includes(option.value as "Avails" | "Panel Info" | "Planning Rates");
        
        let bgClass = 'bg-red-100 border-black';
        if (isConfirmed) {
          bgClass = 'bg-green-100 border-green-500';
        } else if (isAISuggested && !isConfirmed) {
          bgClass = 'bg-yellow-100 border-yellow-500';
        }

        return (
          <button
            key={option.value}
            onClick={() => handleClick(option.value)}
            className={`font-bold border-2 rounded transition-colors px-3.5 py-2 text-md ${bgClass}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
});

// ============================================================================
// LEAD TYPE BUTTON GROUP
// ============================================================================

export const LeadTypeButtonGroup = memo(function LeadTypeButtonGroup({
  className = ""
}: { className?: string }) {
  const confirmedValue = useFormStore((s) => s.confirmedLeadType);
  const aiValue = useFormStore(selectField('leadType'));
  const updateField = useFormStore((s) => s.updateField);
  const setConfirmedLeadType = useFormStore((s) => s.setConfirmedLeadType);

  const options = [
    { value: "Availer", label: "Availer" },
    { value: "Panel Requester", label: "Panel Requester" },
    { value: "Tire Kicker", label: "Tire Kicker" },
  ];

  const handleClick = useCallback((value: string) => {
    updateField('leadType', value);
    setConfirmedLeadType(value);
  }, [updateField, setConfirmedLeadType]);

  return (
    <div className={`flex gap-25 ${className}`}>
      {options.map((option) => {
        let bgClass = 'bg-red-100 border-black';
        if (confirmedValue === option.value) {
          bgClass = 'bg-green-100 border-green-500';
        } else if (aiValue === option.value && !confirmedValue) {
          bgClass = 'bg-yellow-100 border-yellow-500';
        }

        return (
          <button
            key={option.value}
            onClick={() => handleClick(option.value)}
            className={`font-bold border-2 rounded transition-colors px-10 py-2.5 text-md ${bgClass}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
});

// ============================================================================
// BALLPARK INPUT
// ============================================================================

export const BallparkInput = memo(function BallparkInput({
  className = ""
}: { className?: string }) {
  const ballpark = useFormStore((s) => s.ballpark);
  const setBallpark = useFormStore((s) => s.setBallpark);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setBallpark(e.target.value);
  }, [setBallpark]);

  const inputClass = getInputClass(ballpark, "h-10 w-64 text-sm border-2 border-black rounded transition-colors");

  return (
    <Input
      value={ballpark}
      onChange={handleChange}
      placeholder="Manual entry"
      className={`${inputClass} ${className}`}
    />
  );
});