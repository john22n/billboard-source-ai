"use client";

import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { CircleQuestionMark, Minus } from 'lucide-react';
import { useFormStore } from "@/stores/formStore";
import {
  FieldInput,
  FieldTextarea,
  ContactFieldInput,
  MarketFieldInput,
  MarketFieldTextarea,
  LeadTypeButtonGroup,
  BallparkInput,
  DecisionMakerButtonGroup,
  BoardTypeButtonGroup,
  DurationButtonGroup,
  SendOverButtonGroup,
} from "./formFields";

// ============================================================================
// LIMITS
// ============================================================================

const MAX_ADDITIONAL_MARKETS = 1;
const MAX_ADDITIONAL_CONTACTS = 1;

// ============================================================================
// PROPS
// ============================================================================

interface LeadFormProps {
  resetTrigger?: number;
  inboundPhone?: string;
}

// ============================================================================
// LEAD FORM COMPONENT
// ============================================================================

export function LeadForm({ resetTrigger, inboundPhone }: LeadFormProps) {
  // 🔍 Performance monitoring (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log('🔄 Re-render: LeadForm');
  }

  // ✅ Get only what we need from store - NO form data subscription here
  const activeMarketIndex = useFormStore((s) => s.activeMarketIndex);
  const activeContactIndex = useFormStore((s) => s.activeContactIndex);
  const additionalMarkets = useFormStore((s) => s.additionalMarkets);
  const additionalContacts = useFormStore((s) => s.additionalContacts);

  // Actions
  const prefillPhoneFromTwilio = useFormStore((s) => s.prefillPhoneFromTwilio);
  const setActiveMarketIndex = useFormStore((s) => s.setActiveMarketIndex);
  const setActiveContactIndex = useFormStore((s) => s.setActiveContactIndex);
  const addMarket = useFormStore((s) => s.addMarket);
  const removeMarket = useFormStore((s) => s.removeMarket);
  const addContact = useFormStore((s) => s.addContact);
  const removeContact = useFormStore((s) => s.removeContact);

  // ✅ Handle Twilio phone pre-fill
  useEffect(() => {
    if (inboundPhone) {
      prefillPhoneFromTwilio(inboundPhone);
    }
  }, [inboundPhone, prefillPhoneFromTwilio]);

  // Note: Reset is handled by resetForm() in parent's clearAll().
  // The key prop change causes this component to remount with fresh state.
  // No additional reset needed here to avoid double-reset issues.

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
              <FieldInput field="name" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 block">
                What do you want to advertise?
              </Label>
              <div className="flex">
                <FieldInput 
                  field="typeName" 
                  placeholder="Type (Est. B2B, New B2C, etc)"
                  className="w-50"
                />
                <Minus className="mt-2.5 w-2" />
                <FieldInput 
                  field="businessName" 
                  placeholder="Kind (HVAC, Governor, etc)"
                  className="w-50"
                />
                <Minus className="mt-2.5 w-2" />
                <FieldInput 
                  field="entityName" 
                  placeholder="Entity Name"
                  className="flex-1"
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
                <FieldInput 
                  field="billboardsBeforeYN" 
                  placeholder="Y/N"
                  className="w-14 text-center"
                />
                <Minus className="mt-2.5 w-2" />
                <FieldInput 
                  field="billboardsBeforeDetails" 
                  placeholder="Details"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="flex-[1.2]">
              <Label className="text-blue-600 font-bold text-md mb-1 block">
                What are you needing to accomplish?
              </Label>
              <div className="flex">
                <FieldInput 
                  field="billboardPurpose" 
                  placeholder="Goal (Hiring, Event, Brand Awareness, etc)"
                  className="flex-[2]"
                />
                <Minus className="mt-2.5 w-2" />
                <FieldInput 
                  field="accomplishDetails" 
                  placeholder="Details"
                  className="flex-[3]"
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
            <FieldInput field="targetAudience" />
          </div>

          {/* Bottom 3 fields */}
          <div className="flex gap-5">
            <div className="flex-2">
              <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
                Are you doing any other advertising?
                <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
              </Label>
              <FieldInput field="hasMediaExperience" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 block">
                How long in business?
              </Label>
              <FieldInput field="yearsInBusiness" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
                Have a website?
                <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
              </Label>
              <FieldInput field="website" />
            </div>
          </div>
        </div>
      </div>

      {/* Lead Type Bar */}
      <div className="bg-gray-300 border-2 border-black shadow-sm shadow-black rounded-lg p-3.5 my-5 ml-35 -mb-7">
        <div className="flex items-center justify-between">
          <LeadTypeButtonGroup />
          <div className="flex items-center gap-2">
            <Label className="text-md font-bold whitespace-nowrap">Ballpark:</Label>
            <BallparkInput />
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
            <Label className="text-blue-600 font-bold text-md mb-1 block">
              Purpose Recap & Additional Notes
            </Label>
            <FieldTextarea 
              field="notes" 
              className="w-full h-[calc(100%-1.75rem)]"
            />
          </div>

          {/* Right: Location & Duration - Shows Active Market */}
          <div className="flex-1 flex flex-col gap-2.5">
            {/* City, State, Area, and Start in a grid layout */}
            <div className="flex gap-5">
              {/* Left column: City, State, and Start stacked */}
              <div className="flex-[3] space-y-2.5">
                {/* City and State row */}
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <Label className="text-blue-600 font-bold text-md mb-1 block">City</Label>
                    <MarketFieldInput marketIndex={activeMarketIndex} field="targetCity" />
                  </div>
                  <div className="w-18">
                    <Label className="text-blue-600 font-bold text-md mb-1 block">State</Label>
                    <MarketFieldInput 
                      marketIndex={activeMarketIndex} 
                      field="state" 
                      className="text-center"
                    />
                  </div>
                </div>

                {/* Start row */}
                <div>
                  <Label className="text-blue-600 font-bold text-md mb-1 block">Start</Label>
                  <MarketFieldInput marketIndex={activeMarketIndex} field="startMonth" />
                </div>
              </div>

              {/* Right column: Area (spans full height) */}
              <div className="flex-[3]">
                <Label className="text-blue-600 font-bold text-md mb-1 block">Area</Label>
                <MarketFieldTextarea 
                  marketIndex={activeMarketIndex}
                  className="h-[calc(100%-1.75rem)]"
                />
              </div>
            </div>

            {/* Duration and Are you interested in */}
            <div className="flex gap-4 flex-1">
              {/* Duration */}
              <div className="flex-2 flex flex-col">
                <Label className="text-blue-600 font-bold text-md mb-1 block">Duration</Label>
                <DurationButtonGroup marketIndex={activeMarketIndex} />
              </div>

              {/* Are you interested in */}
              <div className="flex-1 mr-11">
                <Label className="text-blue-600 text-center font-bold text-md mb-1 block">
                  Are you interested in?
                </Label>
                <BoardTypeButtonGroup marketIndex={activeMarketIndex} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Market Tabs */}
      <div className="flex flex-wrap gap-1 mt-0 ml-172">
        <button
          onClick={() => setActiveMarketIndex(0)}
          className={`inline-block border-2 ${
            activeMarketIndex === 0 ? 'border-t-0 rounded-b-md' : 'bg-gray-300 text-gray-400 border-t-0 rounded-b-md'
          } border-black shadow-sm shadow-black px-3.5 py-1.5 text-sm font-bold`}
        >
          Mkt #1
        </button>
        {additionalMarkets.map((_, index) => (
          <button
            key={index + 1}
            onClick={() => setActiveMarketIndex(index + 1)}
            className={`inline-block border-2 ${
              activeMarketIndex === index + 1 ? 'border-t-0 rounded-b-md' : 'bg-gray-300 text-gray-400 border-t-0 rounded-b-md'
            } border-black shadow-sm shadow-black px-3.5 py-1.5 text-sm font-bold relative group`}
          >
            <span>Mkt #{index + 2}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                removeMarket(index + 1);
              }}
              className="ml-1.5 text-red-600 hover:text-red-800 cursor-pointer"
            >
              ×
            </span>
          </button>
        ))}
        {canAddMoreMarkets && (
          <button
            onClick={addMarket}
            className="inline-block text-gray-400 hover:text-black px-3.5 py-1.5 text-sm font-bold rounded-b-md transition-colors"
          >
            + Market
          </button>
        )}
      </div>

      {/* Contact Tabs */}
      <div className="flex flex-wrap gap-1 mt-2">
        <button
          onClick={() => setActiveContactIndex(0)}
          className={`inline-block border-2 ${
            activeContactIndex === 0 ? 'border-b-0 rounded-t-md bg-gray-300' : 'bg-white text-gray-400 border-b-0 rounded-t-md'
          } border-black shadow-sm shadow-black px-3.5 py-1.5 text-md font-bold`}
        >
          CONTACT INFO
        </button>
        {additionalContacts.map((contact, index) => (
          <button
            key={contact.id}
            onClick={() => setActiveContactIndex(index + 1)}
            className={`inline-block border-2 ${
              activeContactIndex === index + 1 ? 'border-b-0 rounded-t-md bg-gray-300' : 'bg-white text-gray-400 border-b-0 rounded-t-md'
            } border-black shadow-sm shadow-black px-3.5 py-1.5 text-md font-bold relative group`}
          >
            <span>CONTACT #{index + 2}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                removeContact(index + 1);
              }}
              className="ml-1.5 text-red-600 hover:text-red-800 cursor-pointer"
            >
              ×
            </span>
          </button>
        ))}
        {canAddMoreContacts && (
          <button
            onClick={addContact}
            className="inline-block text-gray-400 hover:text-black px-3.5 py-1.5 text-sm font-bold rounded-t-md transition-colors"
          >
            + Contact
          </button>
        )}
      </div>

      {/* Active Contact */}
      <div className="bg-gray-300 border-2 border-black shadow-black rounded-b-lg rounded-tr-lg p-4 shadow-sm">
        <div className="space-y-3">
          {/* Name, Position, Phone, Email */}
          <div className="grid grid-cols-4 gap-2.5">
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Name</Label>
              <ContactFieldInput contactIndex={activeContactIndex} field="name" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Position</Label>
              <ContactFieldInput contactIndex={activeContactIndex} field="position" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Phone</Label>
              <ContactFieldInput contactIndex={activeContactIndex} field="phone" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Email</Label>
              <ContactFieldInput contactIndex={activeContactIndex} field="email" />
            </div>
          </div>

          {/* Decision making & Thank you */}
          <div className="flex">
            <div className="flex-[1]">
              <Label className="text-blue-600 font-bold text-md mb-1.5 flex items-center gap-1">
                What&apos;s your decision-making process look like?
                <CircleQuestionMark className="w-4 h-4 text-gray-500"/>
              </Label>
              <DecisionMakerButtonGroup contactIndex={activeContactIndex} />
            </div>

            <div className="flex-[1]">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">
                Thank you! I&apos;ll send over:
              </Label>
              <SendOverButtonGroup contactIndex={activeContactIndex} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Export types for parent components
export type { ContactData, MarketData } from "@/stores/formStore";