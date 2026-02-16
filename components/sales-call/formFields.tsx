"use client";

import { memo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormStore, selectField, type BillboardFormData } from "@/stores/formStore";

type FormFieldKey = keyof BillboardFormData;

// ============================================================================
// HELPER: Get input styling based on value (SAFE - handles all types)
// ============================================================================

const getInputClass = (value: unknown, baseClass: string = "") => {
  // Safely check if value is a non-empty string, array, or truthy value
  let hasValue = false;
  
  if (value === null || value === undefined) {
    hasValue = false;
  } else if (typeof value === 'string') {
    hasValue = value.trim() !== '';
  } else if (Array.isArray(value)) {
    hasValue = value.length > 0;
  } else if (typeof value === 'boolean') {
    hasValue = true; // booleans are considered "filled"
  } else {
    hasValue = Boolean(value);
  }
  
  if (hasValue) {
    return `${baseClass} bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500`;
  }
  return `${baseClass} bg-red-100`;
};

// ============================================================================
// HELPER: Get input styling for full name (requires first AND last name)
// ============================================================================

const getFullNameInputClass = (value: unknown, baseClass: string = "") => {
  // Only process if value is a string
  if (typeof value === 'string' && value.trim() !== '') {
    const nameParts = value.trim().split(/\s+/).filter(part => part.length > 0);
    if (nameParts.length >= 2) {
      return `${baseClass} bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500`;
    }
    return `${baseClass} bg-yellow-50 border-yellow-500`;
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
  hasValidationError?: boolean;
}

export const FieldInput = memo(function FieldInput({
  field,
  placeholder,
  className = "",
  baseClassName = "h-9 sm:h-10 text-xs sm:text-sm border-2 border-black rounded transition-colors",
  hasValidationError = false
}: FieldInputProps) {
  const rawValue = useFormStore(selectField(field));
  const updateField = useFormStore((s) => s.updateField);

  if (process.env.NODE_ENV === 'development') {
    console.log(`🔄 Re-render: FieldInput[${field}]`);
  }

  // Convert to string for display
  let value: string | null;
  if (typeof rawValue === 'boolean') {
    value = rawValue ? 'Yes' : 'No';
  } else if (Array.isArray(rawValue)) {
    value = rawValue.join(', ');
  } else {
    value = rawValue as string | null;
  }

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateField(field, e.target.value);
  }, [field, updateField]);

  let inputClass = getInputClass(value, baseClassName);
  
  // Add validation error styling (red ring) if field is empty and has error
  if (hasValidationError && (!value || value.trim() === '')) {
    inputClass += ' ring-2 ring-red-500 ring-offset-1 border-red-500 animate-pulse';
  }

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
// FIRST NAME INPUT - For INTRO section, shows/edits only first name
// ============================================================================

interface FirstNameInputProps {
  className?: string;
  baseClassName?: string;
}

export const FirstNameInput = memo(function FirstNameInput({
  className = "",
  baseClassName = "h-9 sm:h-10 text-xs sm:text-sm border-2 border-black rounded transition-colors"
}: FirstNameInputProps) {
  const fullName = useFormStore(selectField('name'));
  const updateField = useFormStore((s) => s.updateField);

  if (process.env.NODE_ENV === 'development') {
    console.log(`🔄 Re-render: FirstNameInput`);
  }

  const firstName = typeof fullName === 'string' ? fullName.split(' ')[0] : '';
  
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newFirstName = e.target.value;
    const nameParts = typeof fullName === 'string' ? fullName.split(' ') : [];
    const restOfName = nameParts.slice(1).join(' ');
    const newFullName = restOfName 
      ? `${newFirstName} ${restOfName}`
      : newFirstName;
    updateField('name', newFullName);
  }, [fullName, updateField]);

  const inputClass = getInputClass(firstName, baseClassName);

  return (
    <Input
      value={firstName}
      onChange={handleChange}
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
  baseClassName = "text-xs sm:text-sm resize-none border-2 border-black rounded transition-colors"
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
  baseClassName = "h-9 sm:h-10 text-xs sm:text-sm border-2 rounded transition-all",
  hasValidationError = false
}: { className?: string; baseClassName?: string; hasValidationError?: boolean }) {
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

  // Safely convert phone to string
  const phoneStr = typeof phone === 'string' ? phone : '';
  const hasPhone = phoneStr.trim() !== '';

  let colorClass = 'bg-red-100 border-black';
  let wrapperClass = '';
  
  if (hasPhone) {
    if (phoneVerified) {
      colorClass = 'bg-green-100 border-green-600 shadow-lg ring-2 ring-green-400 focus:border-green-700 focus:ring-green-500 focus:ring-offset-1';
      wrapperClass = 'relative';
    } else if (twilioPhonePreFilled) {
      colorClass = 'bg-yellow-50 border-yellow-500 focus:border-yellow-600 focus:ring-yellow-400';
    } else if (userEditedFields.has('phone')) {
      colorClass = 'bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500';
    } else {
      colorClass = 'bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500';
    }
  }

  // Add validation error styling if empty and has error
  if (hasValidationError && !hasPhone) {
    colorClass += ' ring-2 ring-red-500 ring-offset-1 border-red-500 animate-pulse';
  }

  return (
    <div className={wrapperClass}>
      <Input
        value={phoneStr}
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
  hasValidationError?: boolean;
}

export const ContactFieldInput = memo(function ContactFieldInput({
  contactIndex,
  field,
  className = "",
  hasValidationError = false
}: ContactFieldInputProps) {
  const value = useFormStore((s) => {
    if (contactIndex === 0) {
      const val = s.fields[field];
      return typeof val === 'string' ? val : '';
    }
    const contact = s.additionalContacts[contactIndex - 1];
    return contact ? contact[field] : '';
  });
  
  const updateContactField = useFormStore((s) => s.updateContactField);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateContactField(contactIndex, field, e.target.value);
  }, [contactIndex, field, updateContactField]);

  if (contactIndex === 0 && field === 'phone') {
    return <PhoneInput className={className} hasValidationError={hasValidationError} />;
  }

  const baseClassName = "h-9 sm:h-10 text-xs sm:text-sm border-2 border-black rounded transition-colors";
  let inputClass = field === 'name' 
    ? getFullNameInputClass(value, baseClassName)
    : getInputClass(value, baseClassName);

  // Add validation error styling if empty and has error
  if (hasValidationError && (!value || value.trim() === '')) {
    inputClass += ' ring-2 ring-red-500 ring-offset-1 border-red-500 animate-pulse';
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
      const val = s.fields[field];
      return typeof val === 'string' ? val : '';
    }
    const market = s.additionalMarkets[marketIndex - 1];
    return market ? market[field] : '';
  });
  
  const updateMarketField = useFormStore((s) => s.updateMarketField);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateMarketField(marketIndex, field, e.target.value);
  }, [marketIndex, field, updateMarketField]);

  const inputClass = getInputClass(value, "h-9 sm:h-10 text-xs sm:text-sm border-2 border-black rounded transition-colors");

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
      const val = s.fields.targetArea;
      return typeof val === 'string' ? val : '';
    }
    const market = s.additionalMarkets[marketIndex - 1];
    return market ? market.targetArea : '';
  });
  
  const updateMarketField = useFormStore((s) => s.updateMarketField);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateMarketField(marketIndex, 'targetArea', e.target.value);
  }, [marketIndex, updateMarketField]);

  const inputClass = getInputClass(value, "text-xs sm:text-sm resize-none border-2 border-black rounded transition-colors");

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
  buttonClassName = "px-2 sm:px-3.5 py-2 sm:py-2 text-xs sm:text-md"
}: ButtonGroupProps) {
  const aiValue = useFormStore(selectField(field)) as string | null;
  const updateField = useFormStore((s) => s.updateField);

  const handleClick = useCallback((value: string) => {
    updateField(field, value);
    onConfirm(value);
  }, [field, updateField, onConfirm]);

  return (
    <div className={`flex gap-1 sm:gap-3 ${className}`}>
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
  buttonClassName = "px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs sm:text-sm",
  showSubtext = false
}: MultiSelectButtonGroupProps) {
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
    <div className={`flex gap-1.5 sm:gap-2 ${className}`}>
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
              <span className="text-[8px] sm:text-[10px] text-gray-500 font-normal">
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
  
  const aiValue = useFormStore((s) => {
    if (contactIndex === 0) return s.fields.decisionMaker;
    const contact = s.additionalContacts[contactIndex - 1];
    return contact?.decisionMaker ?? null;
  });

  const options = [
    { value: "alone", label: "You Alone", short: "Alone" },
    { value: "boss", label: "My Boss", short: "Boss" },
    { value: "partners", label: "Partners", short: "Part" },
    { value: "committee", label: "Committee", short: "Comm" },
  ];

  const handleClick = useCallback((value: string) => {
    updateContactField(contactIndex, 'decisionMaker', value);
    setConfirmedDecisionMaker(contactIndex, value);
  }, [contactIndex, updateContactField, setConfirmedDecisionMaker]);

  return (
    <div className={`flex gap-1 sm:gap-2 flex-wrap sm:flex-nowrap ${className}`}>
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
            className={`font-bold border-2 rounded transition-colors px-1.5 sm:px-2 md:px-2.5 xl:px-3.5 py-2 sm:py-1.5 xl:py-2 text-[10px] sm:text-xs xl:text-sm whitespace-nowrap flex-1 sm:flex-initial ${bgClass}`}
          >
            <span className="sm:hidden">{option.short}</span>
            <span className="hidden sm:inline">{option.label}</span>
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
    { value: "Static", label: "Static", short: "Sta" },
    { value: "Digital", label: "Digital", short: "Dig" },
    { value: "Both", label: "Both", short: "Both" },
  ];

  const handleClick = useCallback((value: string) => {
    updateMarketField(marketIndex, 'boardType', value);
    setConfirmedBoardType(marketIndex, value);
  }, [marketIndex, updateMarketField, setConfirmedBoardType]);

  return (
    <div className={`flex gap-1 sm:gap-1.5 w-full overflow-hidden ${className}`}>
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
            className={`font-bold border-2 rounded transition-colors px-1 sm:px-3 py-2 sm:py-1.5 text-xs sm:text-sm whitespace-nowrap flex-1 min-w-0 ${bgClass}`}
          >
            <span className="sm:hidden">{option.short}</span>
            <span className="hidden sm:inline">{option.label}</span>
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
  const confirmedSelectionsRaw = useFormStore((s) => s.confirmedDurations[marketIndex]);
  const confirmedSelections = confirmedSelectionsRaw ?? [];

  const setConfirmedDuration = useFormStore((s) => s.setConfirmedDuration);
  const updateMarketField = useFormStore((s) => s.updateMarketField);

  const campaignLengthRaw = useFormStore((s) => marketIndex === 0 ? s.fields.campaignLength : null);
  const aiSuggestions = (() => {
    if (marketIndex !== 0 || !campaignLengthRaw) return [];
    if (Array.isArray(campaignLengthRaw)) return campaignLengthRaw.flat() as string[];
    return [campaignLengthRaw];
  })();

  const options = [
    { value: "1 Mo", label: "1Mo" },
    { value: "3 Mo", label: "3Mo" },
    { value: "6 Mo", label: "6Mo" },
    { value: "12 Mo", label: "1Yr" },
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
    <div className={`flex gap-0.5 sm:gap-1 max-w-full min-w-0 overflow-hidden ${className}`}>
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
          <div key={option.value} className="flex flex-col text-center items-center flex-1 min-w-0">
            <button
              onClick={() => handleClick(option.value)}
              className={`font-bold border-2 rounded text-center transition-colors py-2 sm:px-1.5 sm:py-1 text-[10px] sm:text-xs w-full whitespace-nowrap ${bgClass}`}
            >
              {option.label}
            </button>
            {subtexts[option.value] && (
              <span className="text-[6px] sm:text-[8px] xl:text-[10px] text-gray-500 font-normal">
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
  const confirmedSelectionsRaw = useFormStore((s) => s.confirmedSendOver[contactIndex]);
  const confirmedSelections = confirmedSelectionsRaw ?? [];

  const setConfirmedSendOver = useFormStore((s) => s.setConfirmedSendOver);
  const updateField = useFormStore((s) => s.updateField);

  const sendOverRaw = useFormStore((s) => contactIndex === 0 ? s.fields.sendOver : null);
  const aiSuggestions = (() => {
    if (contactIndex !== 0 || !sendOverRaw) return [];
    if (Array.isArray(sendOverRaw)) return sendOverRaw.flat() as string[];
    return [sendOverRaw as string];
  })();

  const options = [
    { value: "Avails", label: "Avails", short: "Avails" },
    { value: "Panel Info", label: "Panel Info", short: "Panel" },
    { value: "Planning Rates", label: "Planning Rates", short: "Rates" },
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
    <div className={`flex gap-1 sm:gap-2 flex-wrap sm:flex-nowrap ${className}`}>
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
            className={`font-bold border-2 rounded transition-colors px-1.5 sm:px-2.5 xl:px-3.5 py-2 sm:py-1.5 xl:py-2 text-[10px] sm:text-xs xl:text-sm whitespace-nowrap flex-1 sm:flex-initial ${bgClass}`}
          >
            <span className="sm:hidden">{option.short}</span>
            <span className="hidden sm:inline">{option.label}</span>
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
    { value: "Availer", label: "Availer", short: "Avail" },
    { value: "Panel Requester", label: "Panel Requester", short: "Panel" },
    { value: "Tire Kicker", label: "Tire Kicker", short: "Tire K" },
  ];

  const handleClick = useCallback((value: string) => {
    updateField('leadType', value);
    setConfirmedLeadType(value);
  }, [updateField, setConfirmedLeadType]);

  return (
    <div className={`flex flex-nowrap gap-1 sm:gap-1.5 xl:gap-10 ${className}`}>
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
            className={`font-bold border-2 rounded transition-colors px-1.5 sm:px-2 xl:px-3 py-2 sm:py-1.5 xl:py-2 text-[10px] sm:text-xs xl:text-sm whitespace-nowrap flex-1 ${bgClass}`}
          >
            <span className="sm:hidden">{option.short}</span>
            <span className="hidden sm:inline">{option.label}</span>
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

  const inputClass = getInputClass(ballpark, "h-9 sm:h-10 flex-1 sm:w-32 md:w-40 xl:w-64 text-xs sm:text-sm border-2 border-black rounded transition-colors");

  return (
    <Input
      value={ballpark}
      onChange={handleChange}
      placeholder="Manual entry"
      className={`${inputClass} ${className}`}
    />
  );
});