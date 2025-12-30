"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useRef, useCallback } from "react";
import { CircleQuestionMark, Minus } from 'lucide-react';
import { FormFieldStore, useFormField } from "@/hooks/useFormFieldStore";
import type { BillboardFormData } from "@/hooks/useBillboardFormExtraction";

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
  store: FormFieldStore;
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
}

const MAX_ADDITIONAL_MARKETS = 1;
const MAX_ADDITIONAL_CONTACTS = 1;

// ✅ FIELD-LEVEL COMPONENT: Only re-renders when THIS specific field changes
function StoreInput({ 
  store, 
  field, 
  placeholder,
  className = ""
}: { 
  store: FormFieldStore; 
  field: keyof BillboardFormData;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = useFormField(store, field);
  const stringValue = value?.toString() ?? "";
  const isFilled = stringValue.trim() !== "";
  
  const fillClass = isFilled 
    ? "bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500"
    : "bg-red-100";

  return (
    <Input
      value={stringValue}
      onChange={(e) => setValue(e.target.value as BillboardFormData[typeof field])}
      placeholder={placeholder}
      className={`h-10 text-sm border-2 border-black rounded transition-colors ${fillClass} ${className}`}
    />
  );
}

// ✅ FIELD-LEVEL TEXTAREA: Only re-renders when THIS specific field changes
function StoreTextarea({ 
  store, 
  field,
  className = ""
}: { 
  store: FormFieldStore; 
  field: keyof BillboardFormData;
  className?: string;
}) {
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
      className={`text-sm border-2 border-black rounded transition-colors resize-none ${fillClass} ${className}`}
    />
  );
}

// ✅ LEAD TYPE BUTTONS: Only re-renders when leadType field changes
function LeadTypeButtons({
  store,
  confirmedLeadType,
  setConfirmedLeadType
}: {
  store: FormFieldStore;
  confirmedLeadType: string | null;
  setConfirmedLeadType: (value: string) => void;
}) {
  const [value, setValue] = useFormField(store, 'leadType');
  const aiValue = value?.toString() ?? null;

  const getButtonClass = (buttonValue: string) => {
    if (confirmedLeadType === buttonValue) return 'bg-green-100 border-green-500';
    if (aiValue === buttonValue && !confirmedLeadType) return 'bg-yellow-100 border-yellow-500';
    return 'bg-red-100 border-black';
  };

  return (
    <div className="flex gap-25">
      {["Availer", "Panel Requester", "Tire Kicker"].map((type) => (
        <button
          key={type}
          onClick={() => {
            setValue(type as BillboardFormData['leadType']);
            setConfirmedLeadType(type);
          }}
          className={`px-10 py-2.5 text-md font-bold border-2 rounded transition-colors ${getButtonClass(type)}`}
        >
          {type}
        </button>
      ))}
    </div>
  );
}

// ✅ BOARD TYPE BUTTONS: Only re-renders when boardType field changes
function BoardTypeButtons({
  store,
  confirmedValue,
  onConfirm
}: {
  store: FormFieldStore;
  confirmedValue: string | null;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useFormField(store, 'boardType');
  const aiValue = value?.toString() ?? null;

  const getButtonClass = (buttonValue: string) => {
    if (confirmedValue === buttonValue) return 'bg-green-100 border-green-500';
    if (aiValue === buttonValue && !confirmedValue) return 'bg-yellow-100 border-yellow-500';
    return 'bg-red-100 border-black';
  };

  return (
    <div className="flex gap-1.5">
      {["Static", "Digital", "Both"].map((type) => (
        <button
          key={type}
          onClick={() => {
            setValue(type as BillboardFormData['boardType']);
            onConfirm(type);
          }}
          className={`flex justify-center px-2.5 py-1.5 text-md font-bold border-2 rounded flex-1 transition-colors ${getButtonClass(type)}`}
        >
          {type}
        </button>
      ))}
    </div>
  );
}

// ✅ DURATION BUTTONS: Only re-renders when campaignLength field changes
function DurationButtons({
  store,
  confirmedSelections,
  onToggle
}: {
  store: FormFieldStore;
  confirmedSelections: string[];
  onToggle: (value: string, newSelections: string[]) => void;
}) {
  const [value, setValue] = useFormField(store, 'campaignLength');
  
  const aiSuggestions: string[] = (() => {
    if (!value) return [];
    if (Array.isArray(value)) return value.flat() as string[];
    return [value.toString()];
  })();

  const getButtonClass = (buttonValue: string) => {
    if (confirmedSelections.includes(buttonValue)) return 'bg-green-100 border-green-500';
    if (aiSuggestions.includes(buttonValue)) return 'bg-yellow-100 border-yellow-500';
    return 'bg-red-100 border-black';
  };

  const durations = [
    { value: "1 Mo", label: "1 Mo", sub: "(1p)" },
    { value: "3 Mo", label: "3 Mo", sub: "(3p)" },
    { value: "6 Mo", label: "6 Mo", sub: "(6p)" },
    { value: "12 Mo", label: "1 Yr", sub: "(13p)" },
    { value: "TBD", label: "TBD", sub: "" }
  ];

  return (
    <div className="flex gap-2">
      {durations.map((duration) => (
        <div key={duration.value} className="flex flex-col items-center">
          <button
            onClick={() => {
              const newSelections = confirmedSelections.includes(duration.value)
                ? confirmedSelections.filter(v => v !== duration.value)
                : [...confirmedSelections, duration.value];
              setValue(newSelections as BillboardFormData['campaignLength']);
              onToggle(duration.value, newSelections);
            }}
            className={`flex items-center justify-center px-2.5 py-1.5 text-sm font-bold border-2 rounded min-w-[48px] transition-colors ${getButtonClass(duration.value)}`}
          >
            <span>{duration.label}</span>
          </button>
          {duration.sub && <span className="text-[10px] text-gray-500 font-normal">{duration.sub}</span>}
        </div>
      ))}
    </div>
  );
}

// ✅ DECISION MAKER BUTTONS: Only re-renders when decisionMaker field changes
function DecisionMakerButtons({
  store,
  confirmedValue,
  onConfirm
}: {
  store: FormFieldStore;
  confirmedValue: string | null;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useFormField(store, 'decisionMaker');
  const aiValue = value?.toString() ?? null;

  const getButtonClass = (buttonValue: string) => {
    if (confirmedValue === buttonValue) return 'bg-green-100 border-green-500';
    if (aiValue === buttonValue && !confirmedValue) return 'bg-yellow-100 border-yellow-500';
    return 'bg-red-100 border-black';
  };

  const options = [
    { value: "alone", label: "You Alone" },
    { value: "boss", label: "My Boss" },
    { value: "partners", label: "Partners" },
    { value: "committee", label: "Committee" }
  ];

  return (
    <div className="flex gap-3">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => {
            setValue(option.value as BillboardFormData['decisionMaker']);
            onConfirm(option.value);
          }}
          className={`px-3.5 py-2 text-md font-bold border-2 rounded transition-colors ${getButtonClass(option.value)}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ✅ SEND OVER BUTTONS: Only re-renders when sendOver field changes
function SendOverButtons({
  store,
  confirmedSelections,
  onToggle
}: {
  store: FormFieldStore;
  confirmedSelections: string[];
  onToggle: (value: string, newSelections: string[]) => void;
}) {
  const [value, setValue] = useFormField(store, 'sendOver');
  
  const aiSuggestions: string[] = (() => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean) as string[];
    return [];
  })();

  const getButtonClass = (buttonValue: string) => {
    if (confirmedSelections.includes(buttonValue)) return 'bg-green-100 border-green-500';
    if (aiSuggestions.includes(buttonValue)) return 'bg-yellow-100 border-yellow-500';
    return 'bg-red-100 border-black';
  };

  const options = [
    { value: "Avails", label: "Avails" },
    { value: "Panel Info", label: "Panel Info" },
    { value: "Planning Rates", label: "Planning Rates" }
  ];

  return (
    <div className="flex gap-3">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => {
            const newSelections = confirmedSelections.includes(option.value)
              ? confirmedSelections.filter(v => v !== option.value)
              : [...confirmedSelections, option.value];
            setValue(newSelections as BillboardFormData['sendOver']);
            onToggle(option.value, newSelections);
          }}
          className={`px-3.5 py-2 text-md font-bold border-2 rounded transition-colors ${getButtonClass(option.value)}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function LeadForm({ 
  store,
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
  setConfirmedSendOver
}: LeadFormProps) {
  const userEditedFieldsRef = useRef<Set<string>>(new Set());

  // Twilio phone pre-fill
  useEffect(() => {
    if (inboundPhone) {
      setTwilioPhone(inboundPhone);
      const currentPhone = store.getField('phone');
      if (!currentPhone && !userEditedFieldsRef.current.has('phone')) {
        store.setField('phone', inboundPhone, false);
        setTwilioPhonePreFilled(true);
      }
    }
  }, [inboundPhone, store, setTwilioPhone, setTwilioPhonePreFilled]);

  useEffect(() => {
    if (resetTrigger !== undefined) {
      userEditedFieldsRef.current.clear();
    }
  }, [resetTrigger]);

  // Contact management
  const addNewContact = useCallback(() => {
    if (additionalContacts.length >= MAX_ADDITIONAL_CONTACTS) return;
    const newContact: ContactData = {
      id: Date.now().toString(), name: "", position: "", phone: "", email: "", decisionMaker: "", sendOver: []
    };
    setAdditionalContacts([...additionalContacts, newContact]);
    setActiveContactIndex(additionalContacts.length + 1);
  }, [additionalContacts, setAdditionalContacts, setActiveContactIndex]);

  const deleteContact = useCallback((indexToDelete: number) => {
    if (indexToDelete === 0 || additionalContacts.length === 0) return;
    const updatedContacts = additionalContacts.filter((_, idx) => idx !== indexToDelete - 1);
    setAdditionalContacts(updatedContacts);
    if (activeContactIndex >= updatedContacts.length + 1) setActiveContactIndex(updatedContacts.length);
    else if (activeContactIndex > indexToDelete) setActiveContactIndex(activeContactIndex - 1);
    else if (activeContactIndex === indexToDelete) setActiveContactIndex(0);
  }, [additionalContacts, activeContactIndex, setAdditionalContacts, setActiveContactIndex]);

  // Market management
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
    const updatedMarkets = additionalMarkets.filter((_, idx) => idx !== indexToDelete - 1);
    setAdditionalMarkets(updatedMarkets);
    if (activeMarketIndex >= updatedMarkets.length + 1) setActiveMarketIndex(updatedMarkets.length);
    else if (activeMarketIndex > indexToDelete) setActiveMarketIndex(activeMarketIndex - 1);
    else if (activeMarketIndex === indexToDelete) setActiveMarketIndex(0);
  }, [additionalMarkets, activeMarketIndex, setAdditionalMarkets, setActiveMarketIndex]);

  const canAddMoreMarkets = additionalMarkets.length < MAX_ADDITIONAL_MARKETS;
  const canAddMoreContacts = additionalContacts.length < MAX_ADDITIONAL_CONTACTS;

  const isFilled = (value: string | null | undefined) => value && value.trim() !== "";
  const getInputClass = (value: string | null | undefined) => {
    if (isFilled(value)) return "bg-green-50 border-green-500 focus:border-green-600 focus:ring-green-500";
    return "bg-red-100";
  };

  return (
    <div className="lg:flex-[2] space-y-0 px-0.75 py-0.75 overflow-y-auto h-relative">
      {/* INTRO Section */}
      <div className="mb-0">
        <span className="inline-block bg-white border-2 border-b-0 border-black px-3.5 py-1.5 shadow-sm shadow-black text-md font-bold rounded-t-md">INTRO</span>
      </div>
      <div className="bg-white border-2 border-black rounded-b-lg rounded-tr-lg p-4 shadow-sm shadow-black">
        <div className="space-y-3">
          {/* Name and What do you want to advertise */}
          <div className="flex gap-8">
            <div className="w-60">
              <Label className="text-blue-600 font-bold text-md mb-1 block">Name</Label>
              <StoreInput store={store} field="name" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 block">What do you want to advertise?</Label>
              <div className="flex">
                <StoreInput store={store} field="typeName" placeholder="Type (Business, Political, etc)" className="w-50" />
                <Minus className="mt-2.5 w-2" />
                <StoreInput store={store} field="businessName" placeholder="Kind (HVAC, Governor, etc)" className="w-50" />
                <Minus className="mt-2.5 w-2" />
                <StoreInput store={store} field="entityName" placeholder="Entity Name" className="flex-1" />
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
                <StoreInput store={store} field="billboardsBeforeYN" placeholder="Y/N" className="w-14 text-center" />
                <Minus className="mt-2.5 w-2" />
                <StoreInput store={store} field="billboardsBeforeDetails" placeholder="Details" className="flex-1" />
              </div>
            </div>
            <div className="flex-[1.2]">
              <Label className="text-blue-600 font-bold text-md mb-1 block">What are you needing to accomplish?</Label>
              <div className="flex">
                <StoreInput store={store} field="billboardPurpose" placeholder="Goal" className="flex-[2]" />
                <Minus className="mt-2.5 w-2" />
                <StoreInput store={store} field="accomplishDetails" placeholder="Details" className="flex-[3]" />
              </div>
            </div>
          </div>

          {/* Who are you trying to target */}
          <div>
            <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
              Who are you trying to target?
              <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
            </Label>
            <StoreInput store={store} field="targetAudience" />
          </div>

          {/* Bottom 3 fields */}
          <div className="flex gap-5">
            <div className="flex-2">
              <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
                Are you doing any other advertising?
                <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
              </Label>
              <StoreInput store={store} field="hasMediaExperience" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 block">How long in business?</Label>
              <StoreInput store={store} field="yearsInBusiness" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
                Have a website?
                <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
              </Label>
              <StoreInput store={store} field="website" />
            </div>
          </div>
        </div>
      </div>

      {/* Lead Type Bar */}
      <div className="bg-gray-300 border-2 border-black shadow-sm shadow-black rounded-lg p-3.5 my-5 ml-35 -mb-7">
        <div className="flex items-center justify-between">
          <LeadTypeButtons store={store} confirmedLeadType={confirmedLeadType} setConfirmedLeadType={setConfirmedLeadType} />
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
        <span className="inline-block bg-white border-2 border-b-0 border-black shadow-sm shadow-black px-3.5 py-1.5 text-md font-bold rounded-t-md">PROPOSAL</span>
      </div>
      <div className="bg-white border-2 border-black shadow-black rounded-b-lg rounded-tr-lg p-4 shadow-sm">
        <div className="flex gap-5 h-full">
          {/* Left: Purpose Recap */}
          <div className="flex-1">
            <Label className="text-blue-600 font-bold text-md mb-1 block">Purpose Recap & Additional Notes</Label>
            <StoreTextarea store={store} field="notes" className="w-full h-[calc(100%-1.75rem)]" />
          </div>

          {/* Right: Location & Duration */}
          <div className="flex-1 flex flex-col gap-2.5">
            <div className="flex gap-5">
              <div className="flex-[3] space-y-2.5">
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <Label className="text-blue-600 font-bold text-md mb-1 block">City</Label>
                    <StoreInput store={store} field="targetCity" />
                  </div>
                  <div className="w-18">
                    <Label className="text-blue-600 font-bold text-md mb-1 block">State</Label>
                    <StoreInput store={store} field="state" className="text-center" />
                  </div>
                </div>
                <div>
                  <Label className="text-blue-600 font-bold text-md mb-1 block">Start</Label>
                  <StoreInput store={store} field="startMonth" />
                </div>
              </div>
              <div className="flex-[3]">
                <Label className="text-blue-600 font-bold text-md mb-1 block">Area</Label>
                <StoreTextarea store={store} field="targetArea" className="h-[calc(100%-1.75rem)]" />
              </div>
            </div>

            {/* Duration and Board Type */}
            <div className="flex gap-4 flex-1">
              <div className="flex-2 flex flex-col">
                <Label className="text-blue-600 font-bold text-md mb-1 block">Duration</Label>
                <DurationButtons 
                  store={store} 
                  confirmedSelections={confirmedDurations[activeMarketIndex] || []}
                  onToggle={(_, newSelections) => setConfirmedDurations(prev => ({ ...prev, [activeMarketIndex]: newSelections }))}
                />
              </div>
              <div className="flex-1 mr-11">
                <Label className="text-blue-600 text-center font-bold text-md mb-1 block">Are you interested in?</Label>
                <BoardTypeButtons 
                  store={store} 
                  confirmedValue={confirmedBoardTypes[activeMarketIndex] ?? null}
                  onConfirm={(value) => setConfirmedBoardTypes(prev => ({ ...prev, [activeMarketIndex]: value }))}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Market Tabs */}
      <div className="flex flex-wrap gap-1 mt-0 ml-172">
        <button onClick={() => setActiveMarketIndex(0)} className={`inline-block border-2 ${activeMarketIndex === 0 ? 'border-t-0 rounded-b-md' : 'bg-gray-300 text-gray-400 border-t-0 rounded-b-md'} border-black shadow-sm shadow-black px-3.5 py-1.5 text-sm font-bold`}>Mkt #1</button>
        {additionalMarkets.map((_, index) => (
          <button key={index + 1} onClick={() => setActiveMarketIndex(index + 1)} className={`inline-block border-2 ${activeMarketIndex === index + 1 ? 'border-t-0 rounded-b-md' : 'bg-gray-300 text-gray-400 border-t-0 rounded-b-md'} border-black shadow-sm shadow-black px-3.5 py-1.5 text-sm font-bold`}>
            <span>Mkt #{index + 2}</span>
            <span onClick={(e) => { e.stopPropagation(); deleteMarket(index + 1); }} className="ml-1.5 text-red-600 hover:text-red-800 cursor-pointer">×</span>
          </button>
        ))}
        {canAddMoreMarkets && <button onClick={addNewMarket} className="inline-block text-gray-400 hover:text-black px-3.5 py-1.5 text-sm font-bold rounded-b-md transition-colors">+ Market</button>}
      </div>

      {/* Contact Tabs */}
      <div className="flex flex-wrap gap-1 mt-2">
        <button onClick={() => setActiveContactIndex(0)} className={`inline-block border-2 ${activeContactIndex === 0 ? 'border-b-0 rounded-t-md bg-gray-300' : 'bg-white text-gray-400 border-b-0 rounded-t-md'} border-black shadow-sm shadow-black px-3.5 py-1.5 text-md font-bold`}>CONTACT INFO</button>
        {additionalContacts.map((contact, index) => (
          <button key={contact.id} onClick={() => setActiveContactIndex(index + 1)} className={`inline-block border-2 ${activeContactIndex === index + 1 ? 'border-b-0 rounded-t-md bg-gray-300' : 'bg-white text-gray-400 border-b-0 rounded-t-md'} border-black shadow-sm shadow-black px-3.5 py-1.5 text-md font-bold`}>
            <span>CONTACT #{index + 2}</span>
            <span onClick={(e) => { e.stopPropagation(); deleteContact(index + 1); }} className="ml-1.5 text-red-600 hover:text-red-800 cursor-pointer">×</span>
          </button>
        ))}
        {canAddMoreContacts && <button onClick={addNewContact} className="inline-block text-gray-400 hover:text-black px-3.5 py-1.5 text-sm font-bold rounded-t-md transition-colors">+ Contact</button>}
      </div>

      {/* Active Contact - Primary only uses store, additional uses local state */}
      <div className="bg-gray-300 border-2 border-black shadow-black rounded-b-lg rounded-tr-lg p-4 shadow-sm">
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2.5">
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Name</Label>
              <StoreInput store={store} field="name" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Position</Label>
              <StoreInput store={store} field="position" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Phone</Label>
              <StoreInput store={store} field="phone" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Email</Label>
              <StoreInput store={store} field="email" />
            </div>
          </div>

          <div className="flex">
            <div className="flex-[1]">
              <Label className="text-blue-600 font-bold text-md mb-1.5 flex items-center gap-1">
                What&apos;s your decision-making process look like?
                <CircleQuestionMark className="w-4 h-4 text-gray-500"/>
              </Label>
              <DecisionMakerButtons 
                store={store} 
                confirmedValue={confirmedDecisionMakers[activeContactIndex] ?? null}
                onConfirm={(value) => setConfirmedDecisionMakers(prev => ({ ...prev, [activeContactIndex]: value }))}
              />
            </div>
            <div className="flex-[1]">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Thank you! I&apos;ll send over:</Label>
              <SendOverButtons 
                store={store} 
                confirmedSelections={confirmedSendOver[activeContactIndex] || []}
                onToggle={(_, newSelections) => setConfirmedSendOver(prev => ({ ...prev, [activeContactIndex]: newSelections }))}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export type { ContactData, MarketData };