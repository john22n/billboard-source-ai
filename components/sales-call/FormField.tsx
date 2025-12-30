// components/sales-call/FormField.tsx
"use client";

import { memo } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormField, type FormFieldStore } from "@/hooks/useFormFieldStore";
import type { BillboardFormData } from "@/hooks/useBillboardFormExtraction";

interface FormFieldInputProps {
  store: FormFieldStore;
  field: keyof BillboardFormData;
  placeholder?: string;
  className?: string;
  baseClassName?: string;
}

// ✅ This component ONLY re-renders when its specific field value changes
export const FormFieldInput = memo(function FormFieldInput({
  store,
  field,
  placeholder,
  className = "",
  baseClassName = "h-10 text-sm border-2 border-black rounded transition-colors"
}: FormFieldInputProps) {
  const [value, setValue] = useFormField(store, field);
  
  // Convert value to string for input
  const stringValue = value?.toString() ?? "";
  
  // Determine styling based on value
  const isFilled = stringValue.trim() !== "";
  const fillClass = isFilled 
    ? "bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500"
    : "bg-red-100";

  return (
    <Input
      value={stringValue}
      onChange={(e) => setValue(e.target.value as BillboardFormData[typeof field])}
      placeholder={placeholder}
      className={`${baseClassName} ${fillClass} ${className}`}
    />
  );
});

interface FormFieldTextareaProps {
  store: FormFieldStore;
  field: keyof BillboardFormData;
  className?: string;
  baseClassName?: string;
}

// ✅ Textarea version - only re-renders when its field changes
export const FormFieldTextarea = memo(function FormFieldTextarea({
  store,
  field,
  className = "",
  baseClassName = "text-sm border-2 border-black rounded transition-colors resize-none"
}: FormFieldTextareaProps) {
  const [value, setValue] = useFormField(store, field);
  
  const stringValue = value?.toString() ?? "";
  const isFilled = stringValue.trim() !== "";
  const fillClass = isFilled 
    ? "bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500"
    : "bg-red-100";

  return (
    <Textarea
      value={stringValue}
      onChange={(e) => setValue(e.target.value as BillboardFormData[typeof field])}
      className={`${baseClassName} ${fillClass} ${className}`}
    />
  );
});

interface FormFieldButtonGroupProps {
  store: FormFieldStore;
  field: keyof BillboardFormData;
  options: { value: string; label: string }[];
  confirmedValue: string | null;
  onConfirm: (value: string) => void;
  className?: string;
}

// ✅ Button group - only re-renders when its field changes
export const FormFieldButtonGroup = memo(function FormFieldButtonGroup({
  store,
  field,
  options,
  confirmedValue,
  onConfirm,
  className = ""
}: FormFieldButtonGroupProps) {
  const [value, setValue] = useFormField(store, field);
  
  const aiValue = value?.toString() ?? null;

  const getButtonClass = (optionValue: string) => {
    if (confirmedValue === optionValue) {
      return 'bg-green-100 border-green-500';
    }
    if (aiValue === optionValue && !confirmedValue) {
      return 'bg-yellow-100 border-yellow-500';
    }
    return 'bg-red-100 border-black';
  };

  return (
    <div className={`flex gap-3 ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => {
            setValue(option.value as BillboardFormData[typeof field]);
            onConfirm(option.value);
          }}
          className={`px-3.5 py-2 text-md font-bold border-2 rounded transition-colors ${getButtonClass(option.value)}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
});

interface FormFieldMultiSelectProps {
  store: FormFieldStore;
  field: keyof BillboardFormData;
  options: { value: string; label: string; sub?: string }[];
  confirmedSelections: string[];
  onToggle: (value: string) => void;
  className?: string;
}

// ✅ Multi-select buttons - only re-renders when its field changes
export const FormFieldMultiSelect = memo(function FormFieldMultiSelect({
  store,
  field,
  options,
  confirmedSelections,
  onToggle,
  className = ""
}: FormFieldMultiSelectProps) {
  const [value] = useFormField(store, field);
  
  // Get AI suggestions as array
  const aiSuggestions: string[] = (() => {
    if (!value) return [];
    if (Array.isArray(value)) return value.flat() as string[];
    return [value.toString()];
  })();

  const getButtonClass = (optionValue: string) => {
    const isConfirmed = confirmedSelections.includes(optionValue);
    const isAISuggested = aiSuggestions.includes(optionValue);
    
    if (isConfirmed) return 'bg-green-100 border-green-500';
    if (isAISuggested) return 'bg-yellow-100 border-yellow-500';
    return 'bg-red-100 border-black';
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      {options.map((option) => (
        <div key={option.value} className="flex flex-col items-center">
          <button
            onClick={() => onToggle(option.value)}
            className={`flex items-center justify-center px-2.5 py-1.5 text-sm font-bold border-2 rounded min-w-[48px] transition-colors ${getButtonClass(option.value)}`}
          >
            <span>{option.label}</span>
          </button>
          {option.sub && (
            <span className="text-[10px] text-gray-500 font-normal">{option.sub}</span>
          )}
        </div>
      ))}
    </div>
  );
});