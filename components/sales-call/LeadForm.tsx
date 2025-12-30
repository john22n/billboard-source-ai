"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BillboardFormData } from "@/hooks/useBillboardFormExtraction";
import { useEffect, useRef, memo, useCallback } from "react";
import { CircleQuestionMark, Minus} from 'lucide-react';

interface ContactData {
  id: string;
  name: string;
  position: string;
  phone: string;
  email: string;
  decisionMaker: string;
  sendOver: ("Avails" | "Panel Info" | "Planning Rates")[];
}

interface MarketData {
  targetCity: string;
  state: string;
  targetArea: string;
  startMonth: string;
  campaignLength: string[];
  boardType: string;
}

interface LeadFormProps {
  formData: BillboardFormData;
  updateField: (field: string, value: string | boolean | null | string[]) => void;
  resetTrigger?: number;
  inboundPhone?: string;
  additionalContacts: ContactData[];
  setAdditionalContacts: React.Dispatch<React.SetStateAction<ContactData[]>>;
  additionalMarkets: MarketData[];
  setAdditionalMarkets: React.Dispatch<React.SetStateAction<MarketData[]>>;
  activeContactIndex: number;
  setActiveContactIndex: React.Dispatch<React.SetStateAction<number>>;
  activeMarketIndex: number;
  setActiveMarketIndex: React.Dispatch<React.SetStateAction<number>>;
  ballpark: string;
  setBallpark: React.Dispatch<React.SetStateAction<string>>;
  twilioPhone: string;
  setTwilioPhone: React.Dispatch<React.SetStateAction<string>>;
  twilioPhonePreFilled: boolean;
  setTwilioPhonePreFilled: React.Dispatch<React.SetStateAction<boolean>>;
  confirmedLeadType: string | null;
  setConfirmedLeadType: React.Dispatch<React.SetStateAction<string | null>>;
  confirmedDecisionMakers: {[contactIndex: number]: string | null};
  setConfirmedDecisionMakers: React.Dispatch<React.SetStateAction<{[contactIndex: number]: string | null}>>;
  confirmedBoardTypes: {[marketIndex: number]: string | null};
  setConfirmedBoardTypes: React.Dispatch<React.SetStateAction<{[marketIndex: number]: string | null}>>;
  confirmedDurations: {[marketIndex: number]: string[]};
  setConfirmedDurations: React.Dispatch<React.SetStateAction<{[marketIndex: number]: string[]}>>;
  confirmedSendOver: {[contactIndex: number]: string[]};
  setConfirmedSendOver: React.Dispatch<React.SetStateAction<{[contactIndex: number]: string[]}>>;
  changedFields?: Set<string>;
}

const MAX_ADDITIONAL_MARKETS = 1;
const MAX_ADDITIONAL_CONTACTS = 1;

// ✅ MEMOIZED: Input field component
interface MemoizedInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const MemoizedInput = memo(function MemoizedInput({ 
  value, 
  onChange, 
  placeholder, 
  className
}: MemoizedInputProps) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  );
});

// ✅ MEMOIZED: Textarea component
interface MemoizedTextareaProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const MemoizedTextarea = memo(function MemoizedTextarea({
  value,
  onChange,
  className
}: MemoizedTextareaProps) {
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    />
  );
});

export function LeadForm({ 
  formData, 
  updateField, 
  resetTrigger, 
  inboundPhone,
  additionalContacts,
  setAdditionalContacts,
  additionalMarkets,
  setAdditionalMarkets,
  activeContactIndex,
  setActiveContactIndex,
  activeMarketIndex,
  setActiveMarketIndex,
  ballpark,
  setBallpark,
  twilioPhone,
  setTwilioPhone,
  twilioPhonePreFilled,
  setTwilioPhonePreFilled,
  confirmedLeadType,
  setConfirmedLeadType,
  confirmedDecisionMakers,
  setConfirmedDecisionMakers,
  confirmedBoardTypes,
  setConfirmedBoardTypes,
  confirmedDurations,
  setConfirmedDurations,
  confirmedSendOver,
  setConfirmedSendOver,
  changedFields = new Set()
}: LeadFormProps) {
  const userEditedFieldsRef = useRef<Set<string>>(new Set());
  
  const isFilled = useCallback((value: string | null | undefined) => value && value.trim() !== "", []);
  
  // ✅ ENHANCED: Input class with "just updated" ring animation
  const getInputClass = useCallback((value: string | null | undefined, fieldName?: string, baseClass: string = "") => {
    const isRecentlyChanged = fieldName && changedFields.has(fieldName);
    const animationClass = isRecentlyChanged ? "ring-2 ring-yellow-400 ring-opacity-75 animate-pulse" : "";
    
    if (isFilled(value)) {
      return `${baseClass} bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500 ${animationClass}`.trim();
    }
    return `${baseClass} bg-red-100 ${animationClass}`.trim();
  }, [isFilled, changedFields]);
  
  const getButtonClass = useCallback((value: string, aiValue: string | null | undefined, confirmedValue: string | null | undefined) => {
    if (confirmedValue === value) {
      return 'bg-green-100 border-green-500';
    }
    if (aiValue === value && !confirmedValue) {
      return 'bg-yellow-100 border-yellow-500';
    }
    return 'bg-red-100 border-black';
  }, []);
  
  const getMultiSelectButtonClass = useCallback((value: string, aiSuggestions: string[], confirmedSelections: string[]) => {
    const isConfirmed = confirmedSelections.includes(value);
    const isAISuggested = aiSuggestions.includes(value);
    
    if (isConfirmed) {
      return 'bg-green-100 border-green-500';
    }
    if (isAISuggested && !isConfirmed) {
      return 'bg-yellow-100 border-yellow-500';
    }
    return 'bg-red-100 border-black';
  }, []);
  
  const getPhoneInputClass = useCallback((phoneValue: string | null | undefined) => {
    const isRecentlyChanged = changedFields.has('phone');
    const animationClass = isRecentlyChanged ? "ring-2 ring-yellow-400 ring-opacity-75 animate-pulse" : "";
    
    if (!phoneValue || phoneValue.trim() === "") {
      return `bg-red-100 border-black ${animationClass}`.trim();
    }
    
    const wasManuallyEdited = userEditedFieldsRef.current.has('phone');
    
    if (wasManuallyEdited && !twilioPhonePreFilled) {
      return `bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500 ${animationClass}`.trim();
    }
    
    if (twilioPhonePreFilled && phoneValue === twilioPhone) {
      return `bg-yellow-100 border-yellow-500 focus:border-yellow-600 focus:ring-yellow-500 ${animationClass}`.trim();
    }
    
    if (twilioPhone && formData?.phone && formData.phone === twilioPhone && !twilioPhonePreFilled) {
      return `bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500 ${animationClass}`.trim();
    }
    
    if (twilioPhone && formData?.phone && formData.phone !== twilioPhone) {
      return `bg-yellow-100 border-yellow-500 focus:border-yellow-600 focus:ring-yellow-500 ${animationClass}`.trim();
    }
    
    return `bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500 ${animationClass}`.trim();
  }, [twilioPhone, twilioPhonePreFilled, formData?.phone, changedFields]);
  
  useEffect(() => {
    if (inboundPhone) {
      setTwilioPhone(inboundPhone);
      if (!formData?.phone && !userEditedFieldsRef.current.has('phone')) {
        updateField("phone", inboundPhone);
        setTwilioPhonePreFilled(true);
      }
    }
  }, [inboundPhone, formData?.phone, updateField, setTwilioPhone, setTwilioPhonePreFilled]);

  useEffect(() => {
    if (resetTrigger !== undefined) {
      userEditedFieldsRef.current.clear();
    }
  }, [resetTrigger]);

  const handleFieldChange = useCallback((field: string) => (value: string) => {
    userEditedFieldsRef.current.add(field);
    if (field === 'phone') {
      setTwilioPhonePreFilled(false);
    }
    updateField(field, value);
  }, [updateField, setTwilioPhonePreFilled]);

  const addNewContact = useCallback(() => {
    if (additionalContacts.length >= MAX_ADDITIONAL_CONTACTS) return;
    
    const newContact: ContactData = {
      id: Date.now().toString(),
      name: "", position: "", phone: "", email: "", decisionMaker: "", sendOver: []
    };
    setAdditionalContacts([...additionalContacts, newContact]);
    setActiveContactIndex(additionalContacts.length + 1);
  }, [additionalContacts, setAdditionalContacts, setActiveContactIndex]);

  const deleteContact = useCallback((indexToDelete: number) => {
    if (indexToDelete === 0 || additionalContacts.length === 0) return;
    
    const additionalIndex = indexToDelete - 1;
    const updatedContacts = additionalContacts.filter((_, idx) => idx !== additionalIndex);
    setAdditionalContacts(updatedContacts);
    
    if (activeContactIndex >= updatedContacts.length + 1) {
      setActiveContactIndex(updatedContacts.length);
    } else if (activeContactIndex > indexToDelete) {
      setActiveContactIndex(activeContactIndex - 1);
    } else if (activeContactIndex === indexToDelete) {
      setActiveContactIndex(0);
    }
  }, [additionalContacts, activeContactIndex, setAdditionalContacts, setActiveContactIndex]);

  const updateContactField = useCallback((contactIndex: number, field: keyof ContactData, value: string) => {
    if (contactIndex === 0) {
      userEditedFieldsRef.current.add(field);
      if (field === 'phone') setTwilioPhonePreFilled(false);
      if (field === "name" || field === "phone" || field === "email" || field === "decisionMaker" || field === "position") {
        updateField(field, value);
      }
    } else {
      const additionalIndex = contactIndex - 1;
      setAdditionalContacts(prev =>
        prev.map((contact, idx) => idx === additionalIndex ? { ...contact, [field]: value } : contact)
      );
    }
  }, [updateField, setTwilioPhonePreFilled, setAdditionalContacts]);

  const addNewMarket = useCallback(() => {
    if (additionalMarkets.length >= MAX_ADDITIONAL_MARKETS) return;
    
    const newMarket: MarketData = {
      targetCity: "", state: "", targetArea: "", startMonth: "", campaignLength: [], boardType: ""
    };
    setAdditionalMarkets([...additionalMarkets, newMarket]);
    setActiveMarketIndex(additionalMarkets.length + 1);
  }, [additionalMarkets, setAdditionalMarkets, setActiveMarketIndex]);

  const deleteMarket = useCallback((indexToDelete: number) => {
    if (indexToDelete === 0 || additionalMarkets.length === 0) return;
    
    const additionalIndex = indexToDelete - 1;
    const updatedMarkets = additionalMarkets.filter((_, idx) => idx !== additionalIndex);
    setAdditionalMarkets(updatedMarkets);
    
    if (activeMarketIndex >= updatedMarkets.length + 1) {
      setActiveMarketIndex(updatedMarkets.length);
    } else if (activeMarketIndex > indexToDelete) {
      setActiveMarketIndex(activeMarketIndex - 1);
    } else if (activeMarketIndex === indexToDelete) {
      setActiveMarketIndex(0);
    }
  }, [additionalMarkets, activeMarketIndex, setAdditionalMarkets, setActiveMarketIndex]);

  const updateMarketField = useCallback((marketIndex: number, field: keyof MarketData, value: string | string[]) => {
    if (marketIndex === 0) {
      userEditedFieldsRef.current.add(field);
      if (field === "targetCity" || field === "state" || field === "targetArea" || 
          field === "startMonth" || field === "campaignLength" || field === "boardType") {
        updateField(field, value);
      }
    } else {
      const additionalIndex = marketIndex - 1;
      setAdditionalMarkets(prev =>
        prev.map((market, idx) => idx === additionalIndex ? { ...market, [field]: value } : market)
      );
    }
  }, [updateField, setAdditionalMarkets]);

  const currentMarket = activeMarketIndex === 0 
    ? {
        targetCity: formData?.targetCity ?? "",
        state: formData?.state ?? "",
        targetArea: formData?.targetArea ?? "",
        startMonth: formData?.startMonth ?? "",
        campaignLength: (() => {
          const length = formData?.campaignLength;
          if (!length) return [];
          if (Array.isArray(length)) return length.flat() as string[];
          return [length];
        })(),
        boardType: formData?.boardType ?? ""
      }
    : additionalMarkets[activeMarketIndex - 1];

  const currentContact = activeContactIndex === 0
    ? {
        id: "primary",
        name: formData?.name ?? "",
        position: formData?.position ?? "",
        phone: formData?.phone ?? "",
        email: formData?.email ?? "",
        decisionMaker: formData?.decisionMaker ?? "",
        sendOver: (() => {
          const send = formData?.sendOver;
          if (!send) return [];
          return send.filter((item): item is "Avails" | "Panel Info" | "Planning Rates" => item !== undefined);
        })()
      }
    : additionalContacts[activeContactIndex - 1];

  const canAddMoreMarkets = additionalMarkets.length < MAX_ADDITIONAL_MARKETS;
  const canAddMoreContacts = additionalContacts.length < MAX_ADDITIONAL_CONTACTS;

  return (
    <div className="lg:flex-[2] space-y-0 px-0.75 py-0.75 overflow-y-auto h-relative">
      {/* INTRO Section */}
      <div className="mb-0">
        <span className="inline-block bg-white border-2 border-b-0 border-black px-3.5 py-1.5 shadow-sm shadow-black text-md font-bold rounded-t-md">
          INTRO
        </span>
      </div>
      <div className="bg-white border-2 border-black rounded-b-lg rounded-tr-lg p-4 shadow-sm shadow-black">
        <div className="space-y-3">
          {/* Name and What do you want to advertise */}
          <div className="flex gap-8">
            <div className="w-60">
              <Label className="text-blue-600 font-bold text-md mb-1 block">Name</Label>
              <MemoizedInput
                value={formData?.name ?? ""}
                onChange={handleFieldChange('name')}
                className={`h-10 text-sm rounded border-2 transition-colors ${getInputClass(formData?.name, 'name', 'border-black')}`}
              />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 block">What do you want to advertise?</Label>
              <div className="flex">
                <MemoizedInput
                  value={formData?.typeName ?? ""}
                  onChange={handleFieldChange('typeName')}
                  placeholder="Type (Business, Political, etc)"
                  className={`w-50 h-10 text-sm border-2 border-black rounded placeholder:text-gray-400 transition-colors ${getInputClass(formData?.typeName, 'typeName')}`}
                />
                <Minus className="mt-2.5 w-2" />
                <MemoizedInput
                  value={formData?.businessName ?? ""}
                  onChange={handleFieldChange('businessName')}
                  placeholder="Kind (HVAC, Governor, etc)"
                  className={`w-50 h-10 text-sm border-2 border-black rounded placeholder:text-gray-400 transition-colors ${getInputClass(formData?.businessName, 'businessName')}`}
                />
                <Minus className="mt-2.5 w-2" />
                <MemoizedInput
                  value={formData?.entityName ?? ""}
                  onChange={handleFieldChange('entityName')}
                  placeholder="Entity Name"
                  className={`flex-1 h-10 text-sm border-2 border-black rounded placeholder:text-gray-400 transition-colors ${getInputClass(formData?.entityName, 'entityName')}`}
                />
              </div>
            </div>
          </div>

          {/* Ever used billboards / What are you needing */}
          <div className="flex gap-5">
            <div className="flex-[0.5]">
              <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
                Ever used billboards before?
                <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
              </Label>
              <div className="flex">
                <MemoizedInput 
                  value={formData?.billboardsBeforeYN ?? ""}
                  onChange={handleFieldChange('billboardsBeforeYN')}
                  placeholder="Y/N" 
                  className={`w-14 text-sm text-center placeholder:text-gray-400 border-2 border-black rounded px-2.5 h-10 transition-colors ${getInputClass(formData?.billboardsBeforeYN, 'billboardsBeforeYN')}`}
                />
                <Minus className="mt-2.5 w-2" />
                <MemoizedInput
                  value={formData?.billboardsBeforeDetails ?? ""}
                  onChange={handleFieldChange('billboardsBeforeDetails')}
                  placeholder="Details"
                  className={`flex-1 h-10 text-sm border-2 border-black rounded placeholder:text-gray-400 transition-colors ${getInputClass(formData?.billboardsBeforeDetails, 'billboardsBeforeDetails')}`}
                />
              </div>
            </div>

            <div className="flex-[1.2]">
              <Label className="text-blue-600 font-bold text-md mb-1 block">What are you needing to accomplish?</Label>
              <div className="flex">
                <MemoizedInput
                  value={formData?.billboardPurpose ?? ""}
                  onChange={handleFieldChange('billboardPurpose')}
                  placeholder="Goal"
                  className={`flex-[2] h-10 text-sm border-2 border-black rounded placeholder:text-gray-400 transition-colors ${getInputClass(formData?.billboardPurpose, 'billboardPurpose')}`}
                />
                <Minus className="mt-2.5 w-2" />
                <MemoizedInput
                  value={formData?.accomplishDetails ?? ""}
                  onChange={handleFieldChange('accomplishDetails')}
                  placeholder="Details"
                  className={`flex-[3] h-10 text-sm border-2 border-black rounded placeholder:text-gray-400 transition-colors ${getInputClass(formData?.accomplishDetails, 'accomplishDetails')}`}
                />
              </div>
            </div>
          </div>

          {/* Who are you trying to target */}
          <div>
            <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
              Who are you trying to target?
              <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
            </Label>
            <MemoizedInput 
              value={formData?.targetAudience ?? ""}
              onChange={handleFieldChange('targetAudience')}
              className={`h-10 text-sm border-2 border-black rounded transition-colors ${getInputClass(formData?.targetAudience, 'targetAudience')}`}
            />
          </div>

          {/* Bottom 3 fields */}
          <div className="flex gap-5">
            <div className="flex-2">
              <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
                Are you doing any other advertising?
                <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
              </Label>
              <MemoizedInput
                value={formData?.hasMediaExperience?.toString() ?? ""}
                onChange={handleFieldChange('hasMediaExperience')}
                className={`h-10 text-sm border-2 border-black rounded transition-colors ${getInputClass(formData?.hasMediaExperience?.toString(), 'hasMediaExperience')}`}
              />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 block">How long in business?</Label>
              <MemoizedInput
                value={formData?.yearsInBusiness ?? ""}
                onChange={handleFieldChange('yearsInBusiness')}
                className={`h-10 text-sm border-2 border-black rounded transition-colors ${getInputClass(formData?.yearsInBusiness, 'yearsInBusiness')}`}
              />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
                Have a website?
                <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
              </Label>
              <MemoizedInput
                value={formData?.website ?? ""}
                onChange={handleFieldChange('website')}
                className={`h-10 text-sm border-2 border-black rounded transition-colors ${getInputClass(formData?.website, 'website')}`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Lead Type Bar */}
      <div className="bg-gray-300 border-2 border-black shadow-sm shadow-black rounded-lg p-3.5 my-5 ml-35 -mb-7">
        <div className="flex items-center justify-between">
          <div className="flex gap-25">
            {["Availer", "Panel Requester", "Tire Kicker"].map((type) => (
              <button
                key={type}
                onClick={() => {
                  updateField("leadType", type);
                  setConfirmedLeadType(type);
                }}
                className={`px-10 py-2.5 text-md font-bold border-2 rounded transition-colors ${getButtonClass(type, formData?.leadType, confirmedLeadType)}`}
              >
                {type}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-md font-bold whitespace-nowrap">Ballpark:</Label>
            <Input 
              value={ballpark}
              onChange={(e) => setBallpark(e.target.value)}
              placeholder="Manual entry"
              className={`h-10 w-64 text-sm border-2 border-black rounded transition-colors ${getInputClass(ballpark)}`}
            />
          </div>
        </div>
      </div>

      {/* PROPOSAL Section */}
      <div className="mb-0 mt-3.5">
        <span className="inline-block bg-white border-2 border-b-0 border-black shadow-sm shadow-black px-3.5 py-1.5 text-md font-bold rounded-t-md">
          PROPOSAL
        </span>
      </div>
      <div className="bg-white border-2 border-black shadow-black rounded-b-lg rounded-tr-lg p-4 shadow-sm">
        <div className="flex gap-5 h-full">
          {/* Left: Purpose Recap */}
          <div className="flex-1">
            <Label className="text-blue-600 font-bold text-md mb-1 block">Purpose Recap & Additional Notes</Label>
            <MemoizedTextarea
              value={formData?.notes ?? ""}
              onChange={handleFieldChange('notes')}
              className={`w-full h-[calc(100%-1.75rem)] text-sm resize-none border-2 border-black rounded transition-colors ${getInputClass(formData?.notes, 'notes')}`}
            />
          </div>

          {/* Right: Location & Duration */}
          <div className="flex-1 flex flex-col gap-2.5">
            <div className="flex gap-5">
              <div className="flex-[3] space-y-2.5">
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <Label className="text-blue-600 font-bold text-md mb-1 block">City</Label>
                    <MemoizedInput
                      value={currentMarket.targetCity}
                      onChange={(value) => updateMarketField(activeMarketIndex, "targetCity", value)}
                      className={`h-10 text-sm border-2 border-black rounded transition-colors ${getInputClass(currentMarket.targetCity, 'targetCity')}`}
                    />
                  </div>
                  <div className="w-18">
                    <Label className="text-blue-600 font-bold text-md mb-1 block">State</Label>
                    <MemoizedInput 
                      value={currentMarket.state}
                      onChange={(value) => updateMarketField(activeMarketIndex, "state", value)}
                      className={`h-10 text-sm border-2 border-black rounded transition-colors text-center ${getInputClass(currentMarket.state, 'state')}`}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-blue-600 font-bold text-md mb-1 block">Start</Label>
                  <MemoizedInput
                    value={currentMarket.startMonth}
                    onChange={(value) => updateMarketField(activeMarketIndex, "startMonth", value)}
                    className={`h-10 text-sm border-2 border-black rounded transition-colors ${getInputClass(currentMarket.startMonth, 'startMonth')}`}
                  />
                </div>
              </div>
              <div className="flex-[3]">
                <Label className="text-blue-600 font-bold text-md mb-1 block">Area</Label>
                <MemoizedTextarea
                  value={currentMarket.targetArea}
                  onChange={(value) => updateMarketField(activeMarketIndex, "targetArea", value)}
                  className={`h-[calc(100%-1.75rem)] text-sm resize-none border-2 border-black rounded transition-colors ${getInputClass(currentMarket.targetArea, 'targetArea')}`}
                />
              </div>
            </div>

            {/* Duration and Board Type */}
            <div className="flex gap-4 flex-1">
              <div className="flex-2 flex flex-col">
                <Label className="text-blue-600 font-bold text-md mb-1 block">Duration</Label>
                <div className="flex gap-2">
                  {[
                    { value: "1 Mo", label: "1 Mo", sub: "(1p)" },
                    { value: "3 Mo", label: "3 Mo", sub: "(3p)" },
                    { value: "6 Mo", label: "6 Mo", sub: "(6p)" },
                    { value: "12 Mo", label: "1 Yr", sub: "(13p)" },
                    { value: "TBD", label: "TBD", sub: "" }
                  ].map((duration) => {
                    const aiSuggestions = (() => {
                      if (activeMarketIndex !== 0) return [];
                      const length = formData?.campaignLength;
                      if (!length) return [];
                      if (Array.isArray(length)) return length.flat() as string[];
                      return [length];
                    })();
                    const confirmedSelections = confirmedDurations[activeMarketIndex] || [];
                    
                    return (
                      <div key={duration.value} className="flex flex-col items-center">
                        <button
                          onClick={() => {
                            setConfirmedDurations(prev => {
                              const current = prev[activeMarketIndex] || [];
                              const newSelections = current.includes(duration.value)
                                ? current.filter(v => v !== duration.value)
                                : [...current, duration.value];
                              return { ...prev, [activeMarketIndex]: newSelections };
                            });
                            const current = confirmedSelections;
                            const newSelections = current.includes(duration.value)
                              ? current.filter(v => v !== duration.value)
                              : [...current, duration.value];
                            if (activeMarketIndex === 0) {
                              updateField("campaignLength", newSelections);
                            }
                          }}
                          className={`flex items-center justify-center px-2.5 py-1.5 text-sm font-bold border-2 rounded min-w-[48px] transition-colors ${getMultiSelectButtonClass(duration.value, aiSuggestions, confirmedSelections)}`}
                        >
                          <span>{duration.label}</span>
                        </button>
                        {duration.sub && <span className="text-[10px] text-gray-500 font-normal">{duration.sub}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 mr-11">
                <Label className="text-blue-600 text-center font-bold text-md mb-1 block">Are you interested in?</Label>
                <div className="flex gap-1.5">
                  {["Static", "Digital", "Both"].map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        updateMarketField(activeMarketIndex, "boardType", type);
                        setConfirmedBoardTypes(prev => ({...prev, [activeMarketIndex]: type}));
                      }}
                      className={`flex justify-center px-2.5 py-1.5 text-md font-bold border-2 rounded flex-1 transition-colors ${getButtonClass(type, currentMarket.boardType, confirmedBoardTypes[activeMarketIndex])}`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Market Tabs */}
      <div className="flex flex-wrap gap-1 mt-0 ml-172">
        <button
          onClick={() => setActiveMarketIndex(0)}
          className={`inline-block border-2 ${activeMarketIndex === 0 ? 'border-t-0 rounded-b-md' : 'bg-gray-300 text-gray-400 border-t-0 rounded-b-md'} border-black shadow-sm shadow-black px-3.5 py-1.5 text-sm font-bold`}
        >
          Mkt #1
        </button>
        {additionalMarkets.map((_, index) => (
          <button
            key={index + 1}
            onClick={() => setActiveMarketIndex(index + 1)}
            className={`inline-block border-2 ${activeMarketIndex === index + 1 ? 'border-t-0 rounded-b-md' : 'bg-gray-300 text-gray-400 border-t-0 rounded-b-md'} border-black shadow-sm shadow-black px-3.5 py-1.5 text-sm font-bold relative group`}
          >
            <span>Mkt #{index + 2}</span>
            <span onClick={(e) => { e.stopPropagation(); deleteMarket(index + 1); }} className="ml-1.5 text-red-600 hover:text-red-800 cursor-pointer">×</span>
          </button>
        ))}
        {canAddMoreMarkets && (
          <button onClick={addNewMarket} className="inline-block text-gray-400 hover:text-black px-3.5 py-1.5 text-sm font-bold rounded-b-md transition-colors">+ Market</button>
        )}
      </div>

      {/* Contact Tabs */}
      <div className="flex flex-wrap gap-1 mt-2">
        <button
          onClick={() => setActiveContactIndex(0)}
          className={`inline-block border-2 ${activeContactIndex === 0 ? 'border-b-0 rounded-t-md bg-gray-300' : 'bg-white text-gray-400 border-b-0 rounded-t-md'} border-black shadow-sm shadow-black px-3.5 py-1.5 text-md font-bold`}
        >
          CONTACT INFO
        </button>
        {additionalContacts.map((contact, index) => (
          <button
            key={contact.id}
            onClick={() => setActiveContactIndex(index + 1)}
            className={`inline-block border-2 ${activeContactIndex === index + 1 ? 'border-b-0 rounded-t-md bg-gray-300' : 'bg-white text-gray-400 border-b-0 rounded-t-md'} border-black shadow-sm shadow-black px-3.5 py-1.5 text-md font-bold relative group`}
          >
            <span>CONTACT #{index + 2}</span>
            <span onClick={(e) => { e.stopPropagation(); deleteContact(index + 1); }} className="ml-1.5 text-red-600 hover:text-red-800 cursor-pointer">×</span>
          </button>
        ))}
        {canAddMoreContacts && (
          <button onClick={addNewContact} className="inline-block text-gray-400 hover:text-black px-3.5 py-1.5 text-sm font-bold rounded-t-md transition-colors">+ Contact</button>
        )}
      </div>

      {/* Active Contact */}
      <div className="bg-gray-300 border-2 border-black shadow-black rounded-b-lg rounded-tr-lg p-4 shadow-sm">
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2.5">
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Name</Label>
              <MemoizedInput
                value={currentContact.name}
                onChange={(value) => updateContactField(activeContactIndex, "name", value)}
                className={`h-10 text-sm border-2 border-black rounded transition-colors ${getInputClass(currentContact.name, 'name')}`}
              />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Position</Label>
              <MemoizedInput 
                value={currentContact.position}
                onChange={(value) => updateContactField(activeContactIndex, "position", value)}
                className={`h-10 text-sm border-2 border-black rounded transition-colors ${getInputClass(currentContact.position, 'position')}`}
              />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Phone</Label>
              <MemoizedInput
                value={currentContact.phone}
                onChange={(value) => updateContactField(activeContactIndex, "phone", value)}
                className={`h-10 text-sm border-2 rounded transition-colors ${getPhoneInputClass(currentContact.phone)}`}
              />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Email</Label>
              <MemoizedInput
                value={currentContact.email}
                onChange={(value) => updateContactField(activeContactIndex, "email", value)}
                className={`h-10 text-sm border-2 border-black rounded transition-colors ${getInputClass(currentContact.email, 'email')}`}
              />
            </div>
          </div>

          <div className="flex">
            <div className="flex-[1]">
              <Label className="text-blue-600 font-bold text-md mb-1.5 flex items-center gap-1">
                What&apos;s your decision-making process look like?
                <CircleQuestionMark className="w-4 h-4 text-gray-500"/>
              </Label>
              <div className="flex gap-3">
                {[
                  { value: "alone", label: "You Alone" },
                  { value: "boss", label: "My Boss" },
                  { value: "partners", label: "Partners" },
                  { value: "committee", label: "Committee" }
                ].map((maker) => (
                  <button
                    key={maker.value}
                    onClick={() => {
                      updateContactField(activeContactIndex, "decisionMaker", maker.value);
                      setConfirmedDecisionMakers(prev => ({...prev, [activeContactIndex]: maker.value}));
                    }}
                    className={`px-3.5 py-2 text-md font-bold border-2 rounded transition-colors ${getButtonClass(maker.value, currentContact.decisionMaker, confirmedDecisionMakers[activeContactIndex])}`}
                  >
                    {maker.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-[1]">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Thank you! I&apos;ll send over:</Label>
              <div className="flex gap-3">
                {[
                  { value: "Avails", label: "Avails"},
                  { value: "Panel Info", label: "Panel Info"},
                  { value: "Planning Rates", label: "Planning Rates"},
                ].map((item) => {
                  const aiSuggestions = activeContactIndex === 0 
                    ? ((formData?.sendOver ?? []).filter((s): s is "Avails" | "Panel Info" | "Planning Rates" => s !== undefined))
                    : [];
                  const confirmedSelections = confirmedSendOver[activeContactIndex] || [];
                  
                  return (
                    <button
                      key={item.value}
                      onClick={() => {
                        setConfirmedSendOver(prev => {
                          const current = prev[activeContactIndex] || [];
                          const newSelections = current.includes(item.value)
                            ? current.filter(v => v !== item.value)
                            : [...current, item.value];
                          return { ...prev, [activeContactIndex]: newSelections };
                        });
                        if (activeContactIndex === 0) {
                          const current = confirmedSelections;
                          const newSelections = current.includes(item.value)
                            ? current.filter(v => v !== item.value)
                            : [...current, item.value];
                          updateField("sendOver", newSelections);
                        }
                      }}
                      className={`px-3.5 py-2 text-md font-bold border-2 rounded transition-colors ${getMultiSelectButtonClass(item.value, aiSuggestions, confirmedSelections)}`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export type { ContactData, MarketData };